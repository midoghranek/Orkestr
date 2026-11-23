import { route } from "@/server/http";
import { listApprovals } from "@/server/views";
export const dynamic = "force-dynamic";
export const GET = route((req) => {
  const u = req.nextUrl.searchParams;
  return listApprovals({ status: u.get("status") ?? undefined, projectId: u.get("projectId") ?? undefined, runId: u.get("runId") ?? undefined });
});
