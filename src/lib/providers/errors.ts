export type ErrorClass =
  | "not_configured"
  | "auth"
  | "rate_limited"
  | "not_found"
  | "timeout"
  | "network"
  | "server"
  | "client"
  | "validation"
  | "empty";

const RETRYABLE: ReadonlySet<ErrorClass> = new Set(["rate_limited", "timeout", "network", "server"]);

export class ProviderError extends Error {
  readonly provider: string;
  readonly errorClass: ErrorClass;
  readonly status?: number;
  readonly attempts: number;
  readonly retryAfterMs?: number;

  constructor(
    provider: string,
    errorClass: ErrorClass,
    message: string,
    opts: { status?: number; attempts?: number; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(redactSecrets(message), { cause: opts.cause });
    this.name = "ProviderError";
    this.provider = provider;
    this.errorClass = errorClass;
    this.status = opts.status;
    this.attempts = opts.attempts ?? 1;
    this.retryAfterMs = opts.retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.errorClass);
  }
}

export function classifyStatus(status: number): ErrorClass {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "client";
}

const SECRET_QUERY = /([?&](?:api_?key|apikey|token|access_token|key|secret)=)[^&\s"']+/gi;
const BEARER = /(bearer\s+)[a-z0-9._\-]+/gi;

/** Remove anything that looks like a credential from text destined for logs, DB or UI. */
export function redactSecrets(text: string): string {
  let out = text.replace(SECRET_QUERY, "$1[REDACTED]").replace(BEARER, "$1[REDACTED]");
  for (const name of SECRET_ENV_VARS) {
    const value = process.env[name];
    if (value && value.length >= 6) out = out.split(value).join("[REDACTED]");
  }
  return out;
}

export const SECRET_ENV_VARS = [
  "POLYGON_API_KEY",
  "FRED_API_KEY",
  "FINNHUB_API_KEY",
  "ANTHROPIC_API_KEY",
  "ADMIN_TOKEN",
  "SESSION_SECRET",
  "DATABASE_URL",
] as const;

export function toProviderError(provider: string, err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  return new ProviderError(provider, "client", describeError(err), { cause: err });
}

/**
 * Human-useful error text. Database errors wrap the real reason in `cause` and put a huge SQL
 * statement in `message`; show the reason (and only the start of the query).
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (err.message.startsWith("Failed query") && cause instanceof Error) {
    const detail = (cause as { detail?: string }).detail;
    return `Database error: ${cause.message}${detail ? ` (${detail})` : ""} — in: ${err.message.slice(13, 90)}…`;
  }
  return err.message;
}
