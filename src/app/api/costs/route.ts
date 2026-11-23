import { route } from "@/server/http";
import { costSummary } from "@/server/costs";
import { getDb } from "@/server/db";
export const dynamic = "force-dynamic";
export const GET = route((req) => {
  const u = req.nextUrl.searchParams;
  const projectId = u.get("projectId") ?? undefined;
  const runId = u.get("runId") ?? undefined;
  const ledger = getDb()
    .prepare(`SELECT * FROM cost_ledger ${projectId ? "WHERE project_id = ?" : runId ? "WHERE run_id = ?" : ""} ORDER BY ts DESC LIMIT 300`)
    .all(...(projectId ? [projectId] : runId ? [runId] : []));
  return { summary: costSummary({ projectId, runId }), ledger };
});
