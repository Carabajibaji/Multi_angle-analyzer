/**
 * Claude client for plain-English explanations. Claude is never the source of facts here: it only
 * rewrites and organizes data that the pipeline already stored, and its output is schema-validated.
 *
 * Default model: Claude Haiku 4.5 (cheapest current model; override with AI_MODEL).
 */
import { envSecret } from "../env";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { ProviderError } from "../providers/errors";
import type { ProviderObserver } from "../providers/http";

export const DEFAULT_AI_MODEL = "claude-haiku-4-5";

export interface ExplainRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens: number;
}

export interface ExplainResult<T> {
  output: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface Explainer {
  readonly id: string;
  readonly model: string;
  readonly configured: boolean;
  explain<T>(req: ExplainRequest<T>): Promise<ExplainResult<T>>;
}

/** Minimal surface of the SDK we use, so tests can inject a fake. */
export type ParseFn = (params: Record<string, unknown>) => Promise<{
  model: string;
  stop_reason: string | null;
  parsed_output?: unknown;
  usage: { input_tokens: number; output_tokens: number };
}>;

export class AnthropicExplainer implements Explainer {
  readonly id = "anthropic";
  readonly model: string;
  readonly configured: boolean;
  private readonly parse: ParseFn | null;
  private readonly observer?: ProviderObserver;

  constructor(opts: { apiKey?: string; model?: string; parse?: ParseFn; observer?: ProviderObserver } = {}) {
    this.model = opts.model ?? process.env.AI_MODEL ?? DEFAULT_AI_MODEL;
    const apiKey = opts.apiKey ?? envSecret("ANTHROPIC_API_KEY");
    this.observer = opts.observer;
    if (opts.parse) {
      this.parse = opts.parse;
      this.configured = true;
    } else if (apiKey) {
      const client = new Anthropic({ apiKey, maxRetries: 3, timeout: 120_000 });
      this.parse = (params) => client.messages.parse(params as never) as never;
      this.configured = true;
    } else {
      this.parse = null;
      this.configured = false;
    }
  }

  async explain<T>(req: ExplainRequest<T>): Promise<ExplainResult<T>> {
    if (!this.parse) throw new ProviderError(this.id, "not_configured", "ANTHROPIC_API_KEY is not set; AI explanations are disabled.");
    this.observer?.onRequest?.(this.id);
    try {
      const res = await this.parse({
        model: this.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: { format: zodOutputFormat(req.schema as never) },
      });
      if (res.stop_reason === "refusal") throw new ProviderError(this.id, "validation", "The model declined to answer (refusal).");
      if (res.stop_reason === "max_tokens") throw new ProviderError(this.id, "validation", "The explanation was cut off (max_tokens reached).");
      // Re-validate with our own schema: never trust the output shape blindly.
      const checked = req.schema.safeParse(res.parsed_output);
      if (!checked.success) throw new ProviderError(this.id, "validation", "AI output did not match the required schema.");
      this.observer?.onSuccess?.(this.id);
      return { output: checked.data, model: res.model, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
    } catch (err) {
      const pe = toAiError(this.id, err);
      if (pe.errorClass === "rate_limited") this.observer?.onRateLimited?.(this.id, Date.now() + 60_000);
      this.observer?.onError?.(this.id, pe);
      throw pe;
    }
  }
}

function toAiError(id: string, err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  // Most specific first; APIConnectionError is a subclass of APIError in the TS SDK.
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new ProviderError(id, "auth", "Anthropic rejected the API key.", { status: err.status });
  if (err instanceof Anthropic.RateLimitError) return new ProviderError(id, "rate_limited", "Anthropic rate limit reached.", { status: 429 });
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError(id, "network", `Could not reach the Anthropic API: ${err.message}`);
  if (err instanceof Anthropic.APIError) return new ProviderError(id, (err.status ?? 0) >= 500 ? "server" : "client", `Anthropic API error ${err.status ?? ""}: ${err.message}`, { status: err.status ?? undefined });
  return new ProviderError(id, "client", err instanceof Error ? err.message : String(err));
}
