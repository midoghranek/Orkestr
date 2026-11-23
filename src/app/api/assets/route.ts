import { HttpError, route } from "@/server/http";
import { listAssets } from "@/server/assets";
export const dynamic = "force-dynamic";
export const GET = route((req) => {
  const u = req.nextUrl.searchParams;
  const projectId = u.get("projectId");
  if (!projectId) throw new HttpError(400, "projectId required");
  return listAssets(projectId, { kind: u.get("kind") ?? undefined, sceneId: u.get("sceneId") ?? undefined, limit: Math.min(1000, Number(u.get("limit") ?? 500)) });
});
