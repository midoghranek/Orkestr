import { z } from "zod";
import { body, notFound, route } from "@/server/http";
import { getProject } from "@/server/projects";
import { importFile } from "@/server/assets";
import { getSettings } from "@/server/settings";
export const dynamic = "force-dynamic";
export const POST = route<{ id: string }>(async (req, { id }) => {
  if (!getProject(id)) notFound("project");
  const b = z.object({ paths: z.array(z.string().max(1000)).min(1).max(200), label: z.string().max(200).optional(), note: z.string().max(500).optional() }).parse(await body(req));
  const roots = getSettings().importRoots;
  const out = [];
  for (const p of b.paths) out.push(await importFile(p, roots, { projectId: id, label: b.label, metadata: b.note ? { note: b.note } : {} }));
  return out;
});
