import { z } from "zod";
import { body, notFound, route } from "@/server/http";
import { deleteWorkflow, getWorkflow, saveWorkflow } from "@/server/projects";
import { validateGraph } from "@/server/engine/validate";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => {
  const wf = getWorkflow(id) ?? notFound("workflow");
  return { workflow: wf, validation: validateGraph(wf.graph) };
});
export const PUT = route<{ id: string }>(async (req, { id }) => {
  const b = z.object({ name: z.string().max(120).optional(), graph: z.unknown().optional(), expectedVersion: z.number().int().optional() }).parse(await body(req));
  const wf = saveWorkflow(id, b);
  return { workflow: wf, validation: validateGraph(wf.graph) };
});
export const DELETE = route<{ id: string }>((_req, { id }) => {
  deleteWorkflow(id);
  return { deleted: true };
});
