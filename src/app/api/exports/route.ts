import { HttpError, route } from "@/server/http";
import { listExports } from "@/server/exports";
export const dynamic = "force-dynamic";
export const GET = route((req) => {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) throw new HttpError(400, "projectId required");
  return listExports(projectId).map(({ name, size, modifiedAt }) => ({ name, size, modifiedAt }));
});
