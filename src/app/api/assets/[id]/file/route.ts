import fs from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { errorResponse, guard, HttpError } from "@/server/http";
import { getAsset } from "@/server/assets";
import { assetsDir, resolveInside } from "@/server/util/paths";
import path from "node:path";
export const dynamic = "force-dynamic";

/** Streams an asset with HTTP Range support (video scrubbing). Only files inside the asset store are served. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    guard(req);
    const { id } = await ctx.params;
    const a = getAsset(id);
    if (!a) throw new HttpError(404, "asset not found");
    const file = resolveInside(assetsDir(), path.relative(assetsDir(), a.path));
    const size = fs.statSync(file).size;
    const headers: Record<string, string> = { "Content-Type": a.mime, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" };
    if (req.nextUrl.searchParams.get("download")) headers["Content-Disposition"] = `attachment; filename="${encodeURIComponent(a.label.replace(/[^\w.-]+/g, "_"))}${path.extname(file)}"`;
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
      return new Response(stream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, { headers: { ...headers, "Content-Length": String(size) } });
  } catch (e) {
    return errorResponse(e);
  }
}
