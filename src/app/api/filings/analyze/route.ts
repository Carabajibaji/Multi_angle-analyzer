/**
 * Analyze user-supplied text or an uploaded .txt/.htm/.html file (≤ 1 MB). Nothing is stored.
 * The content is parsed as data only (see lib/filings/analyzer.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { analyzeText, htmlToText, MAX_UPLOAD_BYTES } from "@/lib/filings/analyzer";
import { clientKey, rateLimit, sameOrigin } from "@/lib/http/rateLimit";

export const runtime = "nodejs";

const ALLOWED_EXT = /\.(txt|htm|html)$/i;
const ALLOWED_TYPES = new Set(["text/plain", "text/html", "application/xhtml+xml", ""]);

export async function POST(req: NextRequest) {
  if (!sameOrigin(req.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!rateLimit(`docs:${clientKey(req.headers)}`, 30, 3_600_000)) return NextResponse.json({ error: "Too many analyses from this address; try again later." }, { status: 429 });
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD_BYTES * 1.1) return NextResponse.json({ error: "Document too large (max 1 MB)." }, { status: 413 });

  let raw: string;
  let label = "Pasted text";
  const ctype = req.headers.get("content-type") ?? "";
  if (ctype.startsWith("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    if (!ALLOWED_EXT.test(file.name) || !ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: "Only .txt, .htm and .html files are supported." }, { status: 415 });
    if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "File too large (max 1 MB)." }, { status: 413 });
    raw = await file.text();
    label = `Uploaded file: ${file.name.replace(/[^\w.\- ]/g, "_").slice(0, 100)}`;
  } else {
    const parsed = z.object({ text: z.string().min(20).max(MAX_UPLOAD_BYTES) }).safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Provide between 20 characters and 1 MB of text." }, { status: 400 });
    raw = parsed.data.text;
  }
  if (raw.includes("\u0000")) return NextResponse.json({ error: "Binary files are not supported." }, { status: 415 });
  const text = htmlToText(raw);
  const analysis = analyzeText(text, { kind: "user_text", label, url: null, accessionNo: null, form: null, filedAt: null });
  return NextResponse.json(analysis);
}
