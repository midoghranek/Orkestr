import { z } from "zod";
import { body, notFound, route } from "@/server/http";
import { getProject } from "@/server/projects";
import { listPlans, queuePlan } from "@/server/director";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => listPlans(id));
export const POST = route<{ id: string }>(async (req, { id }) => {
  if (!getProject(id)) notFound("project");
  const { brief } = z.object({ brief: z.string().min(10).max(8000) }).parse(await body(req));
  return { planId: queuePlan(id, brief) };
});
