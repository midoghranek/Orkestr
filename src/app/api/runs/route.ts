import { route } from "@/server/http";
import { listRuns } from "@/server/views";
export const dynamic = "force-dynamic";
export const GET = route((req) => {
  const u = req.nextUrl.searchParams;
  return listRuns({ projectId: u.get("projectId") ?? undefined, workflowId: u.get("workflowId") ?? undefined, status: u.get("status") ?? undefined, limit: Math.min(200, Number(u.get("limit") ?? 50)) });
});
