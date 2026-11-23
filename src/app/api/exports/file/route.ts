import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { errorResponse, guard, HttpError } from "@/server/http";
import { exportsDir } from "@/server/exports";
import { resolveInside } from "@/server/util/paths";
import { mimeFor } from "@/server/util/fileserver";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  try {
    guard(req);
    const projectId = req.nextUrl.searchParams.get("projectId");
    const name = req.nextUrl.searchParams.get("name");
    if (!projectId || !name) throw new HttpError(400, "projectId and name required");
    const file = resolveInside(exportsDir(projectId), path.basename(name));
    if (!fs.existsSync(file)) throw new HttpError(404, "export not found");
    return new Response(Readable.toWeb(fs.createReadStream(file)) as ReadableStream, {
      headers: { "Content-Type": mimeFor(file), "Content-Length": String(fs.statSync(file).size), "Content-Disposition": `attachment; filename="${encodeURIComponent(path.basename(file))}"` },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
