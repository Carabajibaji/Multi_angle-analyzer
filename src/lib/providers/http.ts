/**
 * Shared HTTP layer for every provider: timeout, retry with exponential backoff + jitter,
 * Retry-After support, client-side rate limiting, response validation, error classification,
 * health callbacks and secret redaction.
 */
import type { z } from "zod";
import { fingerprint } from "../hash";
import { classifyStatus, ProviderError, redactSecrets } from "./errors";
import type { Fetched } from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderObserver {
  onRequest?(provider: string): void;
  onSuccess?(provider: string): void;
  onError?(provider: string, error: ProviderError): void;
  onRateLimited?(provider: string, untilMs: number): void;
}

export interface HttpClientOptions {
  provider: string;
  baseUrl: string;
  /** Max requests per minute enforced client-side (spacing between request starts). */
  requestsPerMinute: number;
  timeoutMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  headers?: Record<string, string>;
  /** Query parameters added to every request whose values are secrets (removed from recorded URLs). */
  secretQuery?: Record<string, string>;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  observer?: ProviderObserver;
  /** Payloads larger than this (in characters) are not stored as raw source data. */
  maxRawChars?: number;
}

export interface RequestSpec<S extends z.ZodType> {
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  schema: S;
  sourceName: string;
  /** Override the base URL for one request (e.g. SEC uses www.sec.gov and data.sec.gov). */
  baseUrl?: string;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class HttpClient {
  private readonly o: Required<Omit<HttpClientOptions, "observer" | "secretQuery" | "headers">> &
    Pick<HttpClientOptions, "observer" | "secretQuery" | "headers">;
  private nextSlot = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: HttpClientOptions) {
    this.o = {
      timeoutMs: 20_000,
      maxRetries: 4,
      baseBackoffMs: 1_000,
      maxBackoffMs: 60_000,
      fetchImpl: (input, init) => fetch(input, init),
      sleep: defaultSleep,
      now: () => Date.now(),
      maxRawChars: 64_000,
      ...options,
    };
  }

  get provider(): string {
    return this.o.provider;
  }

  /** Public URL without credentials — safe to store and display. */
  publicUrl(path: string, query: RequestSpec<z.ZodType>["query"] = {}, baseUrl = this.o.baseUrl): string {
    const url = new URL(path, baseUrl);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
    return url.toString();
  }

  private requestUrl(spec: RequestSpec<z.ZodType>): string {
    const url = new URL(this.publicUrl(spec.path, spec.query, spec.baseUrl));
    for (const [k, v] of Object.entries(this.o.secretQuery ?? {})) url.searchParams.set(k, v);
    return url.toString();
  }

  /** Serialize request starts so we never exceed requestsPerMinute. */
  private async throttle(): Promise<void> {
    const spacing = 60_000 / Math.max(1, this.o.requestsPerMinute);
    const turn = this.queue.then(async () => {
      const wait = this.nextSlot - this.o.now();
      if (wait > 0) await this.o.sleep(wait);
      this.nextSlot = Math.max(this.o.now(), this.nextSlot) + spacing;
    });
    this.queue = turn.catch(() => undefined);
    await turn;
  }

  private backoff(attempt: number): number {
    const exp = Math.min(this.o.maxBackoffMs, this.o.baseBackoffMs * 2 ** (attempt - 1));
    return Math.round(exp / 2 + Math.random() * (exp / 2));
  }

  async getJson<S extends z.ZodType>(spec: RequestSpec<S>): Promise<Fetched<z.infer<S>>> {
    return this.request(spec, "application/json", (text, publicUrl, attempt) => {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (err) {
        throw new ProviderError(this.o.provider, "validation", `Malformed JSON from ${publicUrl}`, { attempts: attempt, cause: err });
      }
      const parsed = spec.schema.safeParse(json);
      if (!parsed.success) {
        throw new ProviderError(
          this.o.provider,
          "validation",
          `Unexpected response shape from ${publicUrl}: ${parsed.error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
          { attempts: attempt },
        );
      }
      return { data: parsed.data as z.infer<S>, raw: text.length <= this.o.maxRawChars ? json : undefined };
    });
  }

  /** Fetch a text/HTML document (e.g. an SEC filing), rejecting bodies larger than `maxChars`. */
  async getText(spec: Omit<RequestSpec<z.ZodType>, "schema"> & { maxChars?: number }): Promise<Fetched<string>> {
    const max = spec.maxChars ?? 15_000_000;
    return this.request({ ...spec, schema: undefined as never }, "text/html,text/plain;q=0.9,*/*;q=0.5", (text, publicUrl, attempt) => {
      if (text.length > max) throw new ProviderError(this.o.provider, "validation", `Document too large (${text.length} chars) at ${publicUrl}`, { attempts: attempt });
      if (!text.trim()) throw new ProviderError(this.o.provider, "empty", `Empty document at ${publicUrl}`, { attempts: attempt });
      return { data: text, raw: undefined };
    });
  }

  private async request<T>(
    spec: RequestSpec<z.ZodType>,
    accept: string,
    parse: (text: string, publicUrl: string, attempt: number) => { data: T; raw: unknown },
  ): Promise<Fetched<T>> {
    const provider = this.o.provider;
    const publicUrl = this.publicUrl(spec.path, spec.query, spec.baseUrl);
    let lastError: ProviderError | undefined;

    for (let attempt = 1; attempt <= this.o.maxRetries + 1; attempt++) {
      await this.throttle();
      this.o.observer?.onRequest?.(provider);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.o.timeoutMs);
      try {
        let res: Response;
        try {
          res = await this.o.fetchImpl(this.requestUrl(spec), {
            headers: { Accept: accept, ...this.o.headers },
            signal: controller.signal,
            redirect: "error",
          });
        } catch (err) {
          const aborted = controller.signal.aborted;
          throw new ProviderError(
            provider,
            aborted ? "timeout" : "network",
            aborted ? `Request timed out after ${this.o.timeoutMs} ms: ${publicUrl}` : `Network error for ${publicUrl}: ${(err as Error).message}`,
            { attempts: attempt, cause: err },
          );
        }

        const text = await res.text();
        if (!res.ok) {
          const cls = classifyStatus(res.status);
          const retryAfter = parseRetryAfter(res.headers.get("retry-after"), this.o.now());
          if (cls === "rate_limited") this.o.observer?.onRateLimited?.(provider, this.o.now() + (retryAfter ?? this.backoff(attempt)));
          throw new ProviderError(provider, cls, `HTTP ${res.status} from ${publicUrl}: ${text.slice(0, 200)}`, {
            status: res.status,
            attempts: attempt,
            retryAfterMs: retryAfter,
          });
        }

        const { data, raw } = parse(text, publicUrl, attempt);
        this.o.observer?.onSuccess?.(provider);
        return {
          data,
          source: {
            provider,
            name: spec.sourceName,
            url: redactSecrets(publicUrl),
            retrievedAt: new Date(this.o.now()),
            contentHash: fingerprint(text),
            httpStatus: res.status,
            raw,
          },
        };
      } catch (err) {
        const pe = err instanceof ProviderError ? err : new ProviderError(provider, "client", String(err), { attempts: attempt, cause: err });
        lastError = pe;
        if (!pe.retryable || attempt > this.o.maxRetries) break;
        await this.o.sleep(Math.min(this.o.maxBackoffMs, pe.retryAfterMs ?? this.backoff(attempt)));
      } finally {
        clearTimeout(timer);
      }
    }
    const final = new ProviderError(provider, lastError!.errorClass, lastError!.message, {
      status: lastError!.status,
      attempts: lastError!.attempts,
      cause: lastError,
    });
    this.o.observer?.onError?.(provider, final);
    throw final;
  }
}

export function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(header);
  return Number.isFinite(when) ? Math.max(0, when - nowMs) : undefined;
}
