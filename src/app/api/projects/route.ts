import { body, route } from "@/server/http";
import { createProject, listProjects } from "@/server/projects";
export const dynamic = "force-dynamic";
export const GET = route(() => listProjects());
export const POST = route(async (req) => createProject(await body(req)));
