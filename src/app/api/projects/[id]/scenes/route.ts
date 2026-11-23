import { route } from "@/server/http";
import { listScenes } from "@/server/projects";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((req, { id }) => listScenes(id, req.nextUrl.searchParams.get("storyboard") ?? undefined));
