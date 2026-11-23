import { z } from "zod";
import { body, notFound, route } from "@/server/http";
import { createWorkflow, getProject, listWorkflows } from "@/server/projects";
import { getTemplate, instantiate } from "@/server/templates";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => listWorkflows(id));
export const POST = route<{ id: string }>(async (req, { id }) => {
  if (!getProject(id)) notFound("project");
  const b = z
    .object({ name: z.string().min(1).max(120), graph: z.unknown().optional(), templateId: z.string().optional(), vars: z.record(z.string(), z.unknown()).default({}) })
    .parse(await body(req));
  if (b.templateId) {
    const t = getTemplate(b.templateId) ?? notFound("template");
    return createWorkflow(id, b.name, instantiate(t, b.vars), `template:${t.id}`);
  }
  return createWorkflow(id, b.name, b.graph ?? { version: 1, nodes: [], edges: [] });
});
