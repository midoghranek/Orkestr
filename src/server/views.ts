import { getDb, json } from "./db";
import type { Graph } from "@/shared/schema";
import type { NodeRunRow, RunRow } from "./engine/engine";
import { costSummary } from "./costs";
import { getProject, listScenes, listWorkflows } from "./projects";
import { listAssets } from "./assets";
import { listPlans } from "./director";
import { listExports } from "./exports";

export interface RunView {
  id: string;
  workflowId: string;
  workflowName: string;
  projectId: string;
  status: string;
  preauthorizedUsd: number;
  spentUsd: number;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  parentRunId: string | null;
  forceNodes: string[];
  progress: number;
  counts: Record<string, number>;
}

export interface NodeRunView {
  id: string;
  nodeId: string;
  nodeType: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  progress: number;
  progressMessage: string | null;
  error: { code: string; message: string; retryable?: boolean } | null;
  estimate: { usd: number | null; known: boolean; basis: string; quantity?: number; unit?: string } | null;
  costUsd: number;
  cachedFrom: string | null;
  outputs: Record<string, ({ assetId: string } | { value: unknown })[]>;
  startedAt: number | null;
  finishedAt: number | null;
  nextAttemptAt: number;
}

function runView(r: RunRow & { workflow_name?: string }): RunView {
  const counts = getDb().prepare("SELECT status, COUNT(*) c FROM node_runs WHERE run_id = ? GROUP BY status").all(r.id) as { status: string; c: number }[];
  const c = Object.fromEntries(counts.map((x) => [x.status, x.c]));
  const total = counts.reduce((s, x) => s + x.c, 0) || 1;
  const done = (c.completed ?? 0) + (c.skipped ?? 0) + (c.failed ?? 0) + (c.cancelled ?? 0);
  return {
    id: r.id,
    workflowId: r.workflow_id,
    workflowName: r.workflow_name ?? "",
    projectId: r.project_id,
    status: r.status,
    preauthorizedUsd: r.preauthorized_usd,
    spentUsd: r.spent_usd,
    error: r.error,
    createdAt: r.created_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    parentRunId: r.parent_run_id,
    forceNodes: json(r.force_nodes_json, []),
    progress: done / total,
    counts: c,
  };
}

export function nodeRunView(n: NodeRunRow): NodeRunView {
  return {
    id: n.id,
    nodeId: n.node_id,
    nodeType: n.node_type,
    status: n.status,
    attempt: n.attempt,
    maxAttempts: n.max_attempts,
    progress: n.progress,
    progressMessage: n.progress_message,
    error: json(n.error_json, null),
    estimate: json(n.estimate_json, null),
    costUsd: n.cost_usd,
    cachedFrom: n.cached_from,
    outputs: Object.fromEntries(Object.entries(json<Record<string, unknown>>(n.outputs_json, {})).filter(([k]) => !k.startsWith("__"))) as NodeRunView["outputs"],
    startedAt: n.started_at,
    finishedAt: n.finished_at,
    nextAttemptAt: n.next_attempt_at,
  };
}

export function listRuns(filter: { projectId?: string; workflowId?: string; status?: string; limit?: number } = {}): RunView[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (filter.projectId) (where.push("r.project_id = ?"), args.push(filter.projectId));
  if (filter.workflowId) (where.push("r.workflow_id = ?"), args.push(filter.workflowId));
  if (filter.status) (where.push("r.status = ?"), args.push(filter.status));
  args.push(filter.limit ?? 50);
  const rows = getDb()
    .prepare(`SELECT r.*, w.name AS workflow_name FROM runs r JOIN workflows w ON w.id = r.workflow_id ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY r.created_at DESC LIMIT ?`)
    .all(...args) as unknown as (RunRow & { workflow_name: string })[];
  return rows.map(runView);
}

export function runDetail(id: string): { run: RunView; graph: Graph; nodes: NodeRunView[]; approvals: ApprovalView[]; costs: ReturnType<typeof costSummary> } | undefined {
  const r = getDb().prepare("SELECT r.*, w.name AS workflow_name FROM runs r JOIN workflows w ON w.id = r.workflow_id WHERE r.id = ?").get(id) as (RunRow & { workflow_name: string }) | undefined;
  if (!r) return undefined;
  const nodes = (getDb().prepare("SELECT * FROM node_runs WHERE run_id = ? ORDER BY rowid").all(id) as unknown as NodeRunRow[]).map(nodeRunView);
  return { run: runView(r), graph: json<Graph>(r.graph_json, { version: 1, nodes: [], edges: [] }), nodes, approvals: listApprovals({ runId: id }), costs: costSummary({ runId: id }) };
}

export interface ApprovalView {
  id: string;
  projectId: string;
  projectName?: string;
  runId: string | null;
  nodeRunId: string | null;
  nodeId?: string;
  kind: "cost" | "creative";
  status: string;
  title: string;
  detail: string;
  amountUsd: number | null;
  amountKnown: boolean;
  decidedNote: string | null;
  requestedAt: number;
  decidedAt: number | null;
  previewAssetIds: string[];
}

export function listApprovals(filter: { status?: string; projectId?: string; runId?: string } = {}): ApprovalView[] {
  const where: string[] = ["(a.run_id IS NULL OR r.id IS NOT NULL)"];
  const args: string[] = [];
  if (filter.status) (where.push("a.status = ?"), args.push(filter.status));
  if (filter.projectId) (where.push("a.project_id = ?"), args.push(filter.projectId));
  if (filter.runId) (where.push("a.run_id = ?"), args.push(filter.runId));
  const rows = getDb()
    .prepare(
      `SELECT a.*, p.name AS project_name, n.node_id AS node_id, n.run_id AS nr_run, r.graph_json AS graph_json
       FROM approvals a JOIN projects p ON p.id = a.project_id LEFT JOIN node_runs n ON n.id = a.node_run_id LEFT JOIN runs r ON r.id = a.run_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.requested_at DESC LIMIT 200`,
    )
    .all(...args) as Record<string, unknown>[];
  return rows.map((a) => {
    // For creative gates, preview = the assets flowing into the gate.
    const previews: string[] = [];
    if (a.kind === "creative" && a.graph_json && a.node_id) {
      const g = json<Graph>(a.graph_json as string, { version: 1, nodes: [], edges: [] });
      for (const e of g.edges.filter((x) => x.target === a.node_id)) {
        const src = getDb().prepare("SELECT outputs_json FROM node_runs WHERE run_id = ? AND node_id = ?").get(a.run_id as string, e.source) as { outputs_json: string } | undefined;
        for (const v of json<Record<string, { assetId?: string }[]>>(src?.outputs_json, {})[e.sourceHandle] ?? []) if (v.assetId) previews.push(v.assetId);
      }
    }
    return {
      id: a.id as string,
      projectId: a.project_id as string,
      projectName: a.project_name as string,
      runId: (a.run_id as string) ?? null,
      nodeRunId: (a.node_run_id as string) ?? null,
      nodeId: (a.node_id as string) ?? undefined,
      kind: a.kind as "cost" | "creative",
      status: a.status as string,
      title: a.title as string,
      detail: a.detail as string,
      amountUsd: (a.amount_usd as number) ?? null,
      amountKnown: a.amount_known === 1,
      decidedNote: (a.decided_note as string) ?? null,
      requestedAt: a.requested_at as number,
      decidedAt: (a.decided_at as number) ?? null,
      previewAssetIds: previews,
    };
  });
}

export function decideApproval(id: string, decision: "approved" | "rejected", note?: string): ApprovalView {
  const db = getDb();
  const r = db.prepare("UPDATE approvals SET status = ?, decided_note = ?, decided_at = ? WHERE id = ? AND status = 'pending'").run(decision, note ?? null, Date.now(), id);
  if (r.changes !== 1) {
    const cur = db.prepare("SELECT status FROM approvals WHERE id = ?").get(id) as { status: string } | undefined;
    if (!cur) throw new Error("approval not found");
    throw new Error(`approval already ${cur.status}`);
  }
  return listApprovals({}).find((a) => a.id === id)!;
}

export function projectOverview(id: string) {
  const project = getProject(id);
  if (!project) return undefined;
  return {
    project,
    workflows: listWorkflows(project.id).map((w) => ({ id: w.id, name: w.name, version: w.version, source: w.source, nodes: w.graph.nodes.length, updatedAt: w.updatedAt })),
    runs: listRuns({ projectId: project.id, limit: 20 }),
    scenes: listScenes(project.id),
    plans: listPlans(project.id).map((p) => ({ id: p.id, status: p.status, error: p.error, createdAt: p.created_at, finishedAt: p.finished_at, costUsd: p.cost_usd, title: p.plan?.title ?? null, brief: p.brief })),
    assets: listAssets(project.id, { limit: 24 }),
    assetCount: (getDb().prepare("SELECT COUNT(*) c FROM assets WHERE project_id = ?").get(project.id) as { c: number }).c,
    costs: costSummary({ projectId: project.id }),
    approvals: listApprovals({ projectId: project.id, status: "pending" }),
    exports: listExports(project.id).map(({ name, size, modifiedAt }) => ({ name, size, modifiedAt })),
  };
}

export function workerStatus(): { alive: boolean; lastSeen: number | null } {
  const r = getDb().prepare("SELECT value_json, updated_at FROM settings WHERE key = '__worker_heartbeat'").get() as { value_json: string; updated_at: number } | undefined;
  return { alive: !!r && Date.now() - r.updated_at < 15_000, lastSeen: r?.updated_at ?? null };
}
