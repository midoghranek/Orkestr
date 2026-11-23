import fs from "node:fs";
import path from "node:path";
import { HttpError, notFound, route } from "@/server/http";
import { getProject } from "@/server/projects";
import { kindFromExt, registerFile } from "@/server/assets";
import { workDir, safeFileName } from "@/server/util/paths";
import { newId } from "@/server/util/ids";
export const dynamic = "force-dynamic";
const MAX = 1024 * 1024 * 1024;
const ALLOWED = /\.(png|jpe?g|webp|gif|svg|mp4|webm|mov|wav|mp3|m4a|aac|flac|ogg|srt|vtt|json|txt)$/i;
export const POST = route<{ id: string }>(async (req, { id }) => {
  if (!getProject(id)) notFound("project");
  const form = await req.formData();
  const out = [];
  for (const [, v] of form.entries()) {
    if (typeof v === "string") continue;
    const name = safeFileName(v.name);
    if (!ALLOWED.test(name)) throw new HttpError(415, `unsupported file type: ${name}`);
    if (v.size > MAX) throw new HttpError(413, "file too large (1 GB max)");
    const tmp = path.join(workDir(), "uploads", newId("up"), name);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, Buffer.from(await v.arrayBuffer()));
    out.push(await registerFile(tmp, { projectId: id, kind: kindFromExt(name), label: name, move: true, provenance: { source: "upload", originalName: v.name } }));
  }
  if (!out.length) throw new HttpError(400, "no files in upload");
  return out;
});
