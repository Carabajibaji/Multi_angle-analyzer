/**
 * Tolerant reading of secrets pasted into dashboards: trims whitespace, line breaks and wrapping quotes,
 * and strips a leading "NAME=" if the whole .env line was pasted.
 */
export function cleanSecret(raw: string | undefined | null, name?: string): string {
  if (!raw) return "";
  let v = raw.trim();
  if (name && v.startsWith(`${name}=`)) v = v.slice(name.length + 1).trim();
  v = v.replace(/^["'`]+|["'`]+$/g, "").trim();
  return v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] ?? "";
}

export function envSecret(name: string): string {
  return cleanSecret(process.env[name], name);
}

/**
 * Extract a Postgres URL even when a whole snippet was pasted (e.g. `psql 'postgresql://…'` or
 * `DATABASE_URL=postgresql://…`). Returns the input unchanged for pglite: URLs.
 */
export function cleanDatabaseUrl(raw: string | undefined | null): string {
  if (!raw) return "";
  const m = /postgres(?:ql)?:\/\/[^\s'"`]+/.exec(raw);
  if (m) return m[0];
  return cleanSecret(raw, "DATABASE_URL");
}
