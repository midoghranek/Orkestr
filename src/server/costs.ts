import { getDb } from "./db";
import { newId } from "./util/ids";

export interface CostEntry {
  projectId: string;
  runId?: string | null;
  nodeRunId?: string | null;
  provider: string;
  operation: string;
  kind: "estimate" | "actual" | "reused";
  amountUsd: number | null;
  known: boolean;
  unit?: string;
  quantity?: number;
  tokensIn?: number;
  tokensOut?: number;
  note?: string;
}

export function recordCost(e: CostEntry): void {
  getDb()
    .prepare(
      `INSERT INTO cost_ledger (id, project_id, run_id, node_run_id, provider, operation, kind, amount_usd, known, unit, quantity, tokens_in, tokens_out, note, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      newId("cst"),
      e.projectId,
      e.runId ?? null,
      e.nodeRunId ?? null,
      e.provider,
      e.operation,
      e.kind,
      e.amountUsd,
      e.known ? 1 : 0,
      e.unit ?? null,
      e.quantity ?? null,
      e.tokensIn ?? null,
      e.tokensOut ?? null,
      e.note ?? null,
      Date.now(),
    );
}

export interface CostSummary {
  actualKnownUsd: number;
  actualUnknownCount: number;
  estimateKnownUsd: number;
  estimateUnknownCount: number;
  reusedCount: number;
  tokensIn: number;
  tokensOut: number;
  apiCalls: number;
  byProvider: { provider: string; actualUsd: number; unknown: number; calls: number; units: string | null; quantity: number }[];
}

export function costSummary(filter: { projectId?: string; runId?: string }): CostSummary {
  const where: string[] = [];
  const args: string[] = [];
  if (filter.projectId) {
    where.push("project_id = ?");
    args.push(filter.projectId);
  }
  if (filter.runId) {
    where.push("run_id = ?");
    args.push(filter.runId);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const db = getDb();
  const agg = db
    .prepare(
      `SELECT
        COALESCE(SUM(CASE WHEN kind='actual' AND known=1 THEN amount_usd END), 0) AS ak,
        COALESCE(SUM(CASE WHEN kind='actual' AND known=0 THEN 1 END), 0) AS au,
        COALESCE(SUM(CASE WHEN kind='estimate' AND known=1 THEN amount_usd END), 0) AS ek,
        COALESCE(SUM(CASE WHEN kind='estimate' AND known=0 THEN 1 END), 0) AS eu,
        COALESCE(SUM(CASE WHEN kind='reused' THEN 1 END), 0) AS ru,
        COALESCE(SUM(tokens_in), 0) AS ti,
        COALESCE(SUM(tokens_out), 0) AS tout,
        COALESCE(SUM(CASE WHEN kind='actual' THEN 1 END), 0) AS calls
       FROM cost_ledger ${w}`,
    )
    .get(...args) as Record<string, number>;
  const byProvider = db
    .prepare(
      `SELECT provider,
        COALESCE(SUM(CASE WHEN kind='actual' AND known=1 THEN amount_usd END), 0) AS actualUsd,
        COALESCE(SUM(CASE WHEN kind='actual' AND known=0 THEN 1 END), 0) AS unknown,
        COALESCE(SUM(CASE WHEN kind='actual' THEN 1 END), 0) AS calls,
        MAX(unit) AS units,
        COALESCE(SUM(CASE WHEN kind='actual' THEN quantity END), 0) AS quantity
       FROM cost_ledger ${w} GROUP BY provider ORDER BY provider`,
    )
    .all(...args) as CostSummary["byProvider"];
  return {
    actualKnownUsd: agg.ak,
    actualUnknownCount: agg.au,
    estimateKnownUsd: agg.ek,
    estimateUnknownCount: agg.eu,
    reusedCount: agg.ru,
    tokensIn: agg.ti,
    tokensOut: agg.tout,
    apiCalls: agg.calls,
    byProvider,
  };
}
