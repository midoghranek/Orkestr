import { getDb } from "./db";
import { redact, redactDeep } from "./util/redact";

export type Level = "debug" | "info" | "warn" | "error";

export interface EventRow {
  id: number;
  run_id: string | null;
  node_run_id: string | null;
  project_id: string | null;
  level: Level;
  type: string;
  message: string;
  data_json: string | null;
  ts: number;
}

export function emit(e: { level?: Level; type: string; message: string; data?: unknown; runId?: string | null; nodeRunId?: string | null; projectId?: string | null }): void {
  getDb()
    .prepare("INSERT INTO events (run_id, node_run_id, project_id, level, type, message, data_json, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      e.runId ?? null,
      e.nodeRunId ?? null,
      e.projectId ?? null,
      e.level ?? "info",
      e.type,
      redact(e.message).slice(0, 4000),
      e.data === undefined ? null : JSON.stringify(redactDeep(e.data)).slice(0, 64_000),
      Date.now(),
    );
}

export function eventsSince(afterId: number, filter: { runId?: string; projectId?: string; limit?: number } = {}): EventRow[] {
  const where = ["id > ?"];
  const args: (string | number)[] = [afterId];
  if (filter.runId) {
    where.push("run_id = ?");
    args.push(filter.runId);
  }
  if (filter.projectId) {
    where.push("project_id = ?");
    args.push(filter.projectId);
  }
  args.push(filter.limit ?? 500);
  return getDb().prepare(`SELECT * FROM events WHERE ${where.join(" AND ")} ORDER BY id ASC LIMIT ?`).all(...args) as unknown as EventRow[];
}

export function latestEventId(): number {
  const r = getDb().prepare("SELECT COALESCE(MAX(id), 0) AS id FROM events").get() as { id: number };
  return r.id;
}
