import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ADMIN_COOKIE, checkAdminToken, issueSession } from "@/lib/auth/admin";
import { clientKey, rateLimit, sameOrigin } from "@/lib/http/rateLimit";

const body = z.object({ token: z.string().min(1).max(512) });

export async function POST(req: NextRequest) {
  if (!sameOrigin(req.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!rateLimit(`login:${clientKey(req.headers)}`, 5, 60_000)) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !checkAdminToken(parsed.data.token)) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  const session = issueSession();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, session.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: session.maxAgeSeconds });
  return res;
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req.headers)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ADMIN_COOKIE);
  return res;
}
