import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { GraphInvalidError } from "./engine/engine";
import { redact } from "./util/redact";

const LOCAL_HOSTS = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

/**
 * Local-only guard: Orkestr binds to 127.0.0.1, and additionally rejects requests whose Host header is not
 * loopback (DNS-rebinding) and state-changing requests whose Origin is another site (CSRF).
 */
export function guard(req: NextRequest | Request): void {
  const host = req.headers.get("host") ?? "";
  if (!LOCAL_HOSTS.test(host)) throw new HttpError(403, "Orkestr only accepts requests addressed to localhost");
  if (req.method !== "GET" && req.method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin) {
      try {
        if (!LOCAL_HOSTS.test(new URL(origin).host)) throw new HttpError(403, "cross-origin request blocked");
      } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(403, "bad origin");
      }
    }
  }
}

export type Ctx<P extends Record<string, string> = Record<string, string>> = { params: Promise<P> };

export function route<P extends Record<string, string>>(fn: (req: NextRequest, params: P) => Promise<unknown> | unknown) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      guard(req);
      const params = ((await ctx?.params) ?? {}) as P;
      const out = await fn(req, params);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
  if (err instanceof ZodError) return NextResponse.json({ error: "invalid input", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
  if (err instanceof GraphInvalidError) return NextResponse.json({ error: err.message, issues: err.issues }, { status: 422 });
  const msg = redact((err as Error)?.message ?? String(err));
  if (/not found/i.test(msg)) return NextResponse.json({ error: msg }, { status: 404 });
  if (/version conflict/i.test(msg)) return NextResponse.json({ error: msg }, { status: 409 });
  if (/blocked|outside the allowed|does not belong/i.test(msg)) return NextResponse.json({ error: msg }, { status: 403 });
  console.error("[api]", err);
  return NextResponse.json({ error: msg }, { status: 500 });
}

export async function body<T = unknown>(req: NextRequest): Promise<T> {
  const text = await req.text();
  if (text.length > 5_000_000) throw new HttpError(413, "request body too large");
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

export function notFound(what: string): never {
  throw new HttpError(404, `${what} not found`);
}
