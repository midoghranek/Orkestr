import { body, notFound, route } from "@/server/http";
import { deleteProject, getProject, updateProject } from "@/server/projects";
import { projectOverview } from "@/server/views";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => projectOverview(id) ?? notFound("project"));
export const PATCH = route<{ id: string }>(async (req, { id }) => updateProject(id, await body(req)));
export const DELETE = route<{ id: string }>((_req, { id }) => {
  if (!getProject(id)) notFound("project");
  deleteProject(id);
  return { deleted: true };
});
