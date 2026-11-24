import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Graph, NodeStatus, RunStatus } from "@/shared/schema";
import { getDb, json, tx } from "../db";
import { newId, sha256, stableStringify } from "../util/ids";
import { resolveInside, workDir } from "../util/paths";
import { emit } from "../events";
import { recordCost } from "../costs";
import { assetExists, getAsset, registerFile } from "../assets";
import { getAdapter, capabilitySpec, readyCapabilities } from "../adapters/registry";
import { AdapterError, normalizeError, type ExecContext, type ExecResult } from "../adapters/types";
import { getSettings } from "../settings";
import { getNodeDef, isPaidNode, type InVal, type ResolvedInputs } from "./node-types";
import { downstreamOf, validateGraph } from "./validate";
import { sourceHash as remotionSourceHash } from "../adapters/remotion";

/** Bump when a node type's behaviour changes, so cached results from older code are not reused. */
export const ENGINE_VERSION = 2;
const HEARTBEAT_MS = 5_000;
const STALE_MS = 30_000;
const TERMINAL: NodeStatus[] = ["completed", "failed", "cancelled", "skipped"];

export type OutVal = { assetId: string } | { value: unknown };
export type Outputs = Record<string, OutVal[]> & { __inactive?: never };

export interface RunRow {
  id: string;
  workflow_id: string;
  project_id: string;
  status: RunStatus;
  graph_json: string;
  preauthorized_usd: number;
  spent_usd: number;
  force_nodes_json: string;
  parent_run_id: string | null;
  error: string | null;
  cancel_requested: number;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface NodeRunRow {
  id: string;
  run_id: string;
  node_id: string;
  node_type: string;
  status: NodeStatus;
  attempt: number;
  max_attempts: number;
  signature: string | null;
  inputs_json: string;
  outputs_json: string;
  error_json: string | null;
  estimate_json: string | null;
  cost_usd: number;
  cached_from: string | null;
  progress: number;
  progress_message: string | null;
  next_attempt_at: number;
  heartbeat_at: number | null;
  worker_id: string | null;
  started_at: number | null;
  finished_at: number | null;
}

/* ============================ Run management (used by API and worker) ============================ */

export class GraphInvalidError extends Error {
  constructor(public issues: ReturnType<typeof validateGraph>["issues"]) {
    super(`graph is invalid: ${issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`);
    this.name = "GraphInvalidError";
  }
}

export function createRun(workflowId: string, opts: { preauthorizedUsd?: number; forceNodes?: string[]; parentRunId?: string } = {}): string {
  const db = getDb();
  const wf = db.prepare("SELECT id, project_id, graph_json FROM workflows WHERE id = ?").get(workflowId) as { id: string; project_id: string; graph_json: string } | undefined;
  if (!wf) throw new Error("workflow not found");
  const v = validateGraph(json(wf.graph_json, {}));
  if (!v.ok || !v.graph) throw new GraphInvalidError(v.issues);
  const graph = v.graph;
  const runId = newId("run");
  const t = Date.now();
  tx(db, () => {
    db.prepare(
      "INSERT INTO runs (id, workflow_id, project_id, status, graph_json, preauthorized_usd, force_nodes_json, parent_run_id, created_at) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?)",
    ).run(runId, wf.id, wf.project_id, JSON.stringify(graph), Math.max(0, opts.preauthorizedUsd ?? 0), JSON.stringify(opts.forceNodes ?? []), opts.parentRunId ?? null, t);
    const ins = db.prepare("INSERT INTO node_runs (id, run_id, node_id, node_type, status, max_attempts) VALUES (?, ?, ?, ?, 'pending', ?)");
    for (const n of graph.nodes) ins.run(newId("nr"), runId, n.id, n.type, n.retry?.maxAttempts ?? 3);
  });
  emit({ type: "run.created", message: `run created (${graph.nodes.length} nodes)`, runId, projectId: wf.project_id, data: { forceNodes: opts.forceNodes ?? [] } });
  return runId;
}

export function requestCancel(runId: string): void {
  const db = getDb();
  const r = db.prepare("SELECT project_id, status FROM runs WHERE id = ?").get(runId) as { project_id: string; status: RunStatus } | undefined;
  if (!r) throw new Error("run not found");
  if (["completed", "failed", "cancelled"].includes(r.status)) return;
  db.prepare("UPDATE runs SET cancel_requested = 1 WHERE id = ?").run(runId);
  emit({ type: "run.cancel_requested", message: "cancellation requested", runId, projectId: r.project_id });
}

/** Retry failed/skipped/cancelled nodes of a run in place. Completed nodes (e.g. scenes 1–3) are kept. */
export function retryFailed(runId: string, nodeIds?: string[]): void {
  const db = getDb();
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRow | undefined;
  if (!run) throw new Error("run not found");
  const graph = json<Graph>(run.graph_json, { version: 1, nodes: [], edges: [] });
  const rows = db.prepare("SELECT node_id, status FROM node_runs WHERE run_id = ?").all(runId) as { node_id: string; status: NodeStatus }[];
  const seeds = nodeIds ?? rows.filter((r) => ["failed", "cancelled", "skipped"].includes(r.status)).map((r) => r.node_id);
  const reset = downstreamOf(graph, seeds);
  tx(db, () => {
    const st = db.prepare(
      "UPDATE node_runs SET status='pending', attempt=0, error_json=NULL, progress=0, progress_message=NULL, next_attempt_at=0, finished_at=NULL, worker_id=NULL WHERE run_id=? AND node_id=? AND status != 'running'",
    );
    for (const id of reset) st.run(runId, id);
    db.prepare("UPDATE runs SET status='queued', cancel_requested=0, error=NULL, finished_at=NULL WHERE id=?").run(runId);
  });
  emit({ type: "run.retry", message: `retrying ${reset.size} node(s): ${[...reset].join(", ")}`, runId, projectId: run.project_id });
}

/** Selective rerun: a new run of the same graph where `nodeIds` bypass the cache; everything unaffected is reused. */
export function rerunNodes(runId: string, nodeIds: string[]): string {
  const run = getDb().prepare("SELECT workflow_id, preauthorized_usd FROM runs WHERE id = ?").get(runId) as { workflow_id: string; preauthorized_usd: number } | undefined;
  if (!run) throw new Error("run not found");
  return createRun(run.workflow_id, { forceNodes: nodeIds, parentRunId: runId, preauthorizedUsd: run.preauthorized_usd });
}

/* ============================ Worker ============================ */

interface Active {
  controller: AbortController;
  runId: string;
  promise: Promise<void>;
}

export class Engine {
  readonly workerId = `${os.hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 7)}`;
  private active = new Map<string, Active>();
  private timer?: NodeJS.Timeout;
  private hb?: NodeJS.Timeout;
  private ticking = false;
  private stopped = false;

  constructor(private opts: { concurrency?: number; pollMs?: number; staleMs?: number } = {}) {}

  get concurrency(): number {
    return this.opts.concurrency ?? getSettings().concurrency;
  }

  start(): void {
    this.stopped = false;
    this.recoverStale(true);
    this.timer = setInterval(() => void this.tick(), this.opts.pollMs ?? 500);
    this.hb = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.hb) clearInterval(this.hb);
    for (const a of this.active.values()) a.controller.abort();
    await Promise.allSettled([...this.active.values()].map((a) => a.promise));
  }

  /** Wait until every active job finished (tests). */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.active.values()].map((a) => a.promise));
  }

  activeCount(): number {
    return this.active.size;
  }

  private heartbeat(): void {
    if (!this.active.size) return;
    const st = getDb().prepare("UPDATE node_runs SET heartbeat_at = ? WHERE id = ? AND status = 'running'");
    const t = Date.now();
    for (const id of this.active.keys()) st.run(t, id);
  }

  /** Jobs left `running` by a crashed worker are re-queued (or failed if out of attempts). */
  recoverStale(startup = false): number {
    const db = getDb();
    const cutoff = Date.now() - (this.opts.staleMs ?? STALE_MS);
    const rows = db.prepare("SELECT * FROM node_runs WHERE status = 'running' AND (heartbeat_at IS NULL OR heartbeat_at < ?)").all(cutoff) as unknown as NodeRunRow[];
    let n = 0;
    for (const r of rows) {
      if (this.active.has(r.id)) continue;
      if (!startup && r.worker_id === this.workerId) continue;
      const run = db.prepare("SELECT project_id FROM runs WHERE id = ?").get(r.run_id) as { project_id: string };
      if (r.attempt < r.max_attempts) {
        db.prepare("UPDATE node_runs SET status='queued', next_attempt_at=?, worker_id=NULL, progress_message='recovered after worker crash' WHERE id=? AND status='running'").run(Date.now(), r.id);
        emit({ level: "warn", type: "node.recovered", message: `${r.node_id}: worker stopped mid-job; re-queued (attempt ${r.attempt}/${r.max_attempts})`, runId: r.run_id, nodeRunId: r.id, projectId: run?.project_id });
      } else {
        db.prepare("UPDATE node_runs SET status='failed', error_json=?, finished_at=? WHERE id=? AND status='running'").run(
          JSON.stringify({ code: "TOOL_FAILED", message: "worker stopped mid-job and no attempts remain", retryable: false }),
          Date.now(),
          r.id,
        );
      }
      n++;
    }
    return n;
  }

  /** One scheduling pass. Safe to call concurrently (re-entrancy guarded). */
  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      this.recoverStale();
      const db = getDb();
      const runs = db.prepare("SELECT * FROM runs WHERE status IN ('queued','running','waiting_approval') ORDER BY created_at").all() as unknown as RunRow[];
      for (const run of runs) await this.advance(run);
      await this.claim();
    } catch (err) {
      emit({ level: "error", type: "engine.error", message: `scheduler error: ${(err as Error).message}` });
    } finally {
      this.ticking = false;
    }
  }

  /** Run ticks until the given run is terminal (tests / CLI). */
  async runToCompletion(runId: string, timeoutMs = 300_000): Promise<RunStatus> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      await this.tick();
      const r = getDb().prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: RunStatus };
      if (["completed", "failed", "cancelled"].includes(r.status) && this.active.size === 0) return r.status;
      if (r.status === "waiting_approval" && this.active.size === 0) {
        const queued = getDb().prepare("SELECT COUNT(*) c FROM node_runs WHERE run_id=? AND status IN ('queued','running')").get(runId) as { c: number };
        if (queued.c === 0) return r.status;
      }
      if (Date.now() > end) throw new Error(`run ${runId} did not finish in ${timeoutMs}ms (status ${r.status})`);
      await new Promise((res) => setTimeout(res, 25));
    }
  }

  private nodeRuns(runId: string): Map<string, NodeRunRow> {
    const rows = getDb().prepare("SELECT * FROM node_runs WHERE run_id = ?").all(runId) as unknown as NodeRunRow[];
    return new Map(rows.map((r) => [r.node_id, r]));
  }

  private resolveInputs(graph: Graph, nodeId: string, nrs: Map<string, NodeRunRow>): ResolvedInputs {
    const out: ResolvedInputs = {};
    for (const e of graph.edges.filter((x) => x.target === nodeId)) {
      const src = nrs.get(e.source);
      if (!src || src.status !== "completed") continue;
      const outputs = json<Record<string, OutVal[]>>(src.outputs_json, {});
      for (const v of outputs[e.sourceHandle] ?? []) {
        let iv: InVal;
        if ("assetId" in v) {
          const a = getAsset(v.assetId);
          iv = a ? { assetId: a.id, path: a.path, kind: a.kind, meta: { ...a.metadata, sha256: a.sha256, width: a.width, height: a.height, durationS: a.durationS } } : { assetId: v.assetId };
        } else iv = { value: v.value };
        (out[e.targetHandle] ??= []).push(iv);
      }
    }
    return out;
  }

  private signature(type: string, params: unknown, inputs: ResolvedInputs): string {
    const ins = Object.fromEntries(
      Object.entries(inputs).map(([k, list]) => [k, list.map((v) => (v.assetId ? `sha:${(v.meta?.sha256 as string) ?? v.assetId}` : `val:${sha256(stableStringify(v.value))}`))]),
    );
    // Remotion renders also depend on the composition source: hash it in so editing a composition invalidates renders.
    const def = getNodeDef(type);
    const code = [def?.capability, ...(def?.alsoRequires ?? [])].some((c) => c?.startsWith("remotion.")) ? remotionSourceHash() : undefined;
    return sha256(stableStringify({ engine: ENGINE_VERSION, type, params, inputs: ins, code }));
  }

  /** Promote/skip/approve nodes of a run and update its status. */
  private async advance(run: RunRow): Promise<void> {
    const db = getDb();
    const graph = json<Graph>(run.graph_json, { version: 1, nodes: [], edges: [] });
    const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
    const forced = new Set(json<string[]>(run.force_nodes_json, []));
    let nrs = this.nodeRuns(run.id);

    if (run.cancel_requested) {
      for (const [, nr] of nrs) {
        const a = this.active.get(nr.id);
        if (a) a.controller.abort();
      }
      db.prepare("UPDATE node_runs SET status='cancelled', finished_at=? WHERE run_id=? AND status IN ('pending','queued','waiting_approval')").run(Date.now(), run.id);
      db.prepare("UPDATE approvals SET status='cancelled', decided_at=? WHERE run_id=? AND status='pending'").run(Date.now(), run.id);
      const stillRunning = db.prepare("SELECT COUNT(*) c FROM node_runs WHERE run_id=? AND status='running'").get(run.id) as { c: number };
      if (stillRunning.c === 0) {
        db.prepare("UPDATE runs SET status='cancelled', finished_at=? WHERE id=?").run(Date.now(), run.id);
        emit({ type: "run.cancelled", message: "run cancelled", runId: run.id, projectId: run.project_id });
      }
      return;
    }

    if (!run.started_at) db.prepare("UPDATE runs SET started_at=? WHERE id=?").run(Date.now(), run.id);
    const settings = getSettings();
    const incomingOf = (id: string) => graph.edges.filter((e) => e.target === id);

    let changed = true;
    while (changed) {
      changed = false;
      nrs = this.nodeRuns(run.id);
      for (const [nodeId, nr] of nrs) {
        const node = nodesById.get(nodeId);
        if (!node) continue;
        const def = getNodeDef(node.type);
        if (!def) continue;

        if (nr.status === "waiting_approval") {
          const ap = db.prepare("SELECT status, decided_note FROM approvals WHERE node_run_id = ? ORDER BY requested_at DESC LIMIT 1").get(nr.id) as { status: string; decided_note: string | null } | undefined;
          if (ap?.status === "approved") {
            if (def.builtin === "approval") {
              const inputs = this.resolveInputs(graph, nodeId, nrs);
              const out: OutVal[] = (inputs.in ?? []).map((v) => (v.assetId ? { assetId: v.assetId } : { value: v.value }));
              db.prepare("UPDATE node_runs SET status='completed', outputs_json=?, progress=1, finished_at=? WHERE id=?").run(JSON.stringify({ out }), Date.now(), nr.id);
              emit({ type: "node.approved", message: `${nodeId}: approved${ap.decided_note ? ` — ${ap.decided_note}` : ""}`, runId: run.id, nodeRunId: nr.id, projectId: run.project_id });
            } else {
              db.prepare("UPDATE node_runs SET status='queued', next_attempt_at=0 WHERE id=?").run(nr.id);
              emit({ type: "node.cost_approved", message: `${nodeId}: spend approved`, runId: run.id, nodeRunId: nr.id, projectId: run.project_id });
            }
            changed = true;
          } else if (ap?.status === "rejected") {
            db.prepare("UPDATE node_runs SET status='failed', error_json=?, finished_at=? WHERE id=?").run(
              JSON.stringify({ code: "REJECTED", message: `rejected by user${ap.decided_note ? `: ${ap.decided_note}` : ""}`, retryable: false }),
              Date.now(),
              nr.id,
            );
            emit({ level: "warn", type: "node.rejected", message: `${nodeId}: rejected`, runId: run.id, nodeRunId: nr.id, projectId: run.project_id });
            changed = true;
          }
          continue;
        }

        if (nr.status !== "pending") continue;
        const edges = incomingOf(nodeId);
        const deps = edges.map((e) => ({ e, nr: nrs.get(e.source)! }));
        if (deps.some((d) => !d.nr || !TERMINAL.includes(d.nr.status))) continue;

        // Failure propagates: a node never runs with silently missing upstream work ("optional" only means
        // "may be left unconnected"). Edges from skipped nodes or untaken condition branches are inactive;
        // a node runs if it still has an active edge on every connected required input.
        const inactive = (d: (typeof deps)[number]) => {
          if (d.nr.status !== "completed") return true;
          const o = json<Record<string, unknown>>(d.nr.outputs_json, {});
          return Array.isArray(o.__inactive) && (o.__inactive as string[]).includes(d.e.sourceHandle);
        };
        const anyFailed = deps.some((d) => d.nr.status === "failed" || d.nr.status === "cancelled");
        const allInactive = deps.length > 0 && deps.every(inactive);
        const requiredBlocked = def.inputs.some((inp) => {
          const ds = deps.filter((d) => d.e.targetHandle === inp.name);
          return ds.length > 0 && !inp.optional && ds.every(inactive);
        });
        if (anyFailed || allInactive || requiredBlocked) {
          db.prepare("UPDATE node_runs SET status='skipped', finished_at=? WHERE id=?").run(Date.now(), nr.id);
          emit({ type: "node.skipped", message: `${nodeId}: skipped (upstream ${anyFailed ? "failed" : "branch not taken"})`, runId: run.id, nodeRunId: nr.id, projectId: run.project_id });
          changed = true;
          continue;
        }

        const inputs = this.resolveInputs(graph, nodeId, nrs);
        const parsed = def.params.safeParse(node.params ?? {});
        const params = parsed.success ? parsed.data : node.params;
        const signature = this.signature(node.type, params, inputs);

        if (def.builtin === "condition") {
          const value = inputs.in?.[0]?.value ?? (inputs.in?.[0]?.path ? json(fs.readFileSync(inputs.in[0].path!, "utf8"), null) : null);
          const result = evalCondition(value, params as never);
          const outputs = { [result ? "true" : "false"]: [{ value }], __inactive: [result ? "false" : "true"] };
          db.prepare("UPDATE node_runs SET status='completed', signature=?, outputs_json=?, progress=1, started_at=?, finished_at=? WHERE id=?").run(signature, JSON.stringify(outputs), Date.now(), Date.now(), nr.id);
          emit({ type: "node.completed", message: `${nodeId}: condition → ${result}`, runId: run.id, nodeRunId: nr.id, projectId: run.project_id });
          changed = true;
          continue;
        }

        if (def.builtin === "approval") {
          const p = params as { title: string; instructions: string };
          // A person already approved exactly this content (same gate, same input bytes) in this project — e.g. the
          // captions after a text-only edit. Re-asking would only add friction; record the carried-over decision.
          const prior = db
            .prepare(
              "SELECT a.id FROM approvals a JOIN node_runs n ON n.id = a.node_run_id JOIN runs r ON r.id = n.run_id WHERE a.kind = 'creative' AND a.status = 'approved' AND n.signature = ? AND r.project_id = ? AND COALESCE(a.decided_note, '') NOT LIKE 'Carried over%' LIMIT 1",
            )
            .get(signature, run.project_id) as { id: string } | undefined;
          db.prepare(
            "INSERT INTO approvals (id, project_id, run_id, node_run_id, kind, status, title, detail, decided_note, requested_at, decided_at) VALUES (?, ?, ?, ?, 'creative', ?, ?, ?, ?, ?, ?)",
          ).run(newId("apv"), run.project_id, run.id, nr.id, prior ? "approved" : "pending", p.title, p.instructions, prior ? `Carried over: you approved identical content earlier (${prior.id})` : null, Date.now(), prior ? Date.now() : null);
          db.prepare("UPDATE node_runs SET status='waiting_approval', signature=? WHERE id=?").run(signature, nr.id);
          emit({ type: prior ? "approval.carried_over" : "approval.requested", message: prior ? `${nodeId}: identical content was already approved — carried over` : `${nodeId}: waiting for creative approval — ${p.title}`, runId: run.id, nodeRunId: nr.id, projectId: run.project_id });
          changed = true;
          continue;
        }

        // Cache: identical node type + params + input bytes ⇒ reuse a previous successful result.
        if (!forced.has(nodeId)) {
          const hit = db
            .prepare(
              "SELECT nr.id, nr.outputs_json FROM node_runs nr JOIN runs r ON r.id = nr.run_id WHERE nr.signature = ? AND nr.status = 'completed' AND r.project_id = ? AND nr.id != ? ORDER BY nr.finished_at DESC LIMIT 5",
            )
            .all(signature, run.project_id, nr.id) as { id: string; outputs_json: string }[];
          const usable = hit.find((h) => {
            const o = json<Record<string, OutVal[]>>(h.outputs_json, {});
            return Object.values(o).every((list) => !Array.isArray(list) || list.every((v) => !("assetId" in v) || (getAsset(v.assetId) && assetExists(getAsset(v.assetId)!))));
          });
          if (usable) {
            db.prepare("UPDATE node_runs SET status='completed', signature=?, outputs_json=?, cached_from=?, progress=1, started_at=?, finished_at=? WHERE id=?").run(
              signature,
              usable.outputs_json,
              usable.id,
              Date.now(),
              Date.now(),
              nr.id,
            );
            recordCost({ projectId: run.project_id, runId: run.id, nodeRunId: nr.id, provider: def.capability?.split(".")[0] ?? "engine", operation: node.type, kind: "reused", amountUsd: 0, known: true, note: `reused ${usable.id}` });
            emit({ type: "node.cached", message: `${nodeId}: reused cached result`, runId: run.id, nodeRunId: nr.id, projectId: run.project_id, data: { from: usable.id } });
            changed = true;
            continue;
          }
        }

        // Paid work needs explicit approval unless inside a preauthorized bound.
        if (isPaidNode(def, params, inputs)) {
          const est = await this.estimate(def, params, inputs);
          db.prepare("UPDATE node_runs SET estimate_json=? WHERE id=?").run(JSON.stringify(est), nr.id);
          recordCost({ projectId: run.project_id, runId: run.id, nodeRunId: nr.id, provider: est.provider, operation: node.type, kind: "estimate", amountUsd: est.usd, known: est.known, unit: est.unit, quantity: est.quantity, note: est.basis });
          // Committed = already spent + estimates of paid steps approved in this run that have not finished yet.
          const spent = (db.prepare("SELECT spent_usd FROM runs WHERE id=?").get(run.id) as { spent_usd: number }).spent_usd;
          const inFlight = (
            db
              .prepare(
                "SELECT COALESCE(SUM(a.amount_usd), 0) s FROM approvals a JOIN node_runs n ON n.id = a.node_run_id WHERE a.run_id = ? AND a.kind = 'cost' AND a.status = 'approved' AND n.status IN ('queued','running')",
              )
              .get(run.id) as { s: number }
          ).s;
          const withinPreauth = est.known && est.usd !== null && run.preauthorized_usd > 0 && spent + inFlight + est.usd <= run.preauthorized_usd + 1e-9;
          const autoUnder = est.known && est.usd !== null && settings.autoApproveUnderUsd > 0 && est.usd <= settings.autoApproveUnderUsd;
          if (withinPreauth || autoUnder) {
            db.prepare(
              "INSERT INTO approvals (id, project_id, run_id, node_run_id, kind, status, title, detail, amount_usd, amount_known, decided_note, requested_at, decided_at) VALUES (?, ?, ?, ?, 'cost', 'approved', ?, ?, ?, 1, ?, ?, ?)",
            ).run(newId("apv"), run.project_id, run.id, nr.id, `${node.label ?? nodeId}`, est.basis, est.usd, withinPreauth ? "within preauthorized run budget" : "under auto-approve threshold", Date.now(), Date.now());
          } else {
            db.prepare(
              "INSERT INTO approvals (id, project_id, run_id, node_run_id, kind, status, title, detail, amount_usd, amount_known, requested_at) VALUES (?, ?, ?, ?, 'cost', 'pending', ?, ?, ?, ?, ?)",
            ).run(newId("apv"), run.project_id, run.id, nr.id, `Paid step: ${node.label ?? def.label}`, `${est.basis}${est.quantity ? ` (${est.quantity} ${est.unit})` : ""}`, est.usd, est.known ? 1 : 0, Date.now());
            db.prepare("UPDATE node_runs SET status='waiting_approval', signature=? WHERE id=?").run(signature, nr.id);
            emit({ type: "approval.requested", message: `${nodeId}: paid step waits for approval (${est.known ? `$${est.usd?.toFixed(4)}` : "price unknown"})`, runId: run.id, nodeRunId: nr.id, projectId: run.project_id });
            changed = true;
            continue;
          }
        }

        db.prepare("UPDATE node_runs SET status='queued', signature=?, inputs_json=?, next_attempt_at=0 WHERE id=?").run(signature, JSON.stringify(inputs), nr.id);
        changed = true;
      }
    }

    // Run status.
    nrs = this.nodeRuns(run.id);
    const sts = [...nrs.values()].map((n) => n.status);
    let status: RunStatus;
    if (sts.every((s) => TERMINAL.includes(s))) {
      const failed = [...nrs.values()].filter((n) => n.status === "failed" || n.status === "cancelled");
      status = failed.length ? "failed" : "completed";
      if (run.status !== status) {
        db.prepare("UPDATE runs SET status=?, finished_at=?, error=? WHERE id=?").run(status, Date.now(), failed.length ? `${failed.length} node(s) failed: ${failed.map((f) => f.node_id).join(", ")}` : null, run.id);
        emit({ level: failed.length ? "error" : "info", type: `run.${status}`, message: `run ${status}`, runId: run.id, projectId: run.project_id });
      }
      return;
    }
    if (sts.some((s) => s === "running" || s === "queued")) status = "running";
    else if (sts.some((s) => s === "waiting_approval")) status = "waiting_approval";
    else status = "running";
    if (run.status !== status) db.prepare("UPDATE runs SET status=? WHERE id=?").run(status, run.id);
  }

  private async estimate(def: NonNullable<ReturnType<typeof getNodeDef>>, params: unknown, inputs: ResolvedInputs) {
    const e = def.estimate?.(params as never, inputs) ?? (def.capability ? { capability: def.capability, params: params as Record<string, unknown> } : null);
    if (!e) return { provider: "engine", usd: 0 as number | null, known: true, basis: "free", unit: undefined as string | undefined, quantity: undefined as number | undefined };
    const [adapterId, op] = e.capability.split(".");
    const adapter = getAdapter(adapterId);
    const spec = capabilitySpec(e.capability);
    const est = adapter ? await adapter.estimateCost(op, e.params).catch(() => ({ usd: null, known: false, basis: "estimate failed" })) : { usd: null, known: false, basis: "no adapter" };
    return { provider: adapterId, ...est, basis: est.basis || (spec?.cost.model === "unknown" ? spec.cost.note : "") };
  }

  private async claim(): Promise<void> {
    const free = this.concurrency - this.active.size;
    if (free <= 0) return;
    const db = getDb();
    const rows = db
      .prepare("SELECT nr.* FROM node_runs nr JOIN runs r ON r.id = nr.run_id WHERE nr.status='queued' AND nr.next_attempt_at <= ? AND r.cancel_requested = 0 ORDER BY r.created_at, nr.rowid LIMIT ?")
      .all(Date.now(), free) as unknown as NodeRunRow[];
    for (const r of rows) {
      const t = Date.now();
      const res = db
        .prepare("UPDATE node_runs SET status='running', attempt=attempt+1, worker_id=?, started_at=COALESCE(started_at, ?), heartbeat_at=?, progress=0, progress_message='starting' WHERE id=? AND status='queued'")
        .run(this.workerId, t, t, r.id);
      if (res.changes !== 1) continue;
      db.prepare("UPDATE runs SET status='running' WHERE id=? AND status IN ('queued','waiting_approval')").run(r.run_id);
      const controller = new AbortController();
      const promise = this.execute({ ...r, attempt: r.attempt + 1 }, controller).finally(() => this.active.delete(r.id));
      this.active.set(r.id, { controller, runId: r.run_id, promise });
    }
  }

  private async execute(nr: NodeRunRow, controller: AbortController): Promise<void> {
    const db = getDb();
    const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(nr.run_id) as unknown as RunRow;
    const graph = json<Graph>(run.graph_json, { version: 1, nodes: [], edges: [] });
    const node = graph.nodes.find((n) => n.id === nr.node_id)!;
    const def = getNodeDef(node.type)!;
    const dir = resolveInside(workDir(), path.join(run.id, nr.node_id, String(nr.attempt)));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    let lastProgress = 0;
    const exec: ExecContext = {
      signal: controller.signal,
      workDir: dir,
      projectId: run.project_id,
      runId: run.id,
      nodeRunId: nr.id,
      progress: (f, msg) => {
        const now = Date.now();
        if (now - lastProgress < 250 && f < 1) return;
        lastProgress = now;
        db.prepare("UPDATE node_runs SET progress=?, progress_message=COALESCE(?, progress_message), heartbeat_at=? WHERE id=?").run(Math.max(0, Math.min(1, f)), msg ?? null, now, nr.id);
      },
      log: (level, message, data) => emit({ level, type: "node.log", message: `${nr.node_id}: ${message}`, data, runId: run.id, nodeRunId: nr.id, projectId: run.project_id }),
    };
    const costs: NonNullable<ExecResult["cost"]>[] = [];
    const seen = new Set<object>();
    const ready = readyCapabilities();
    const call = async (capability: string, params: Record<string, unknown>) => {
      if (!ready.has(capability)) throw new AdapterError("NOT_AVAILABLE", `${capability} is not ready on this machine`);
      const [adapterId, op] = capability.split(".");
      const adapter = getAdapter(adapterId);
      if (!adapter) throw new AdapterError("NOT_AVAILABLE", `no adapter ${adapterId}`);
      const r = await adapter.execute(op, params, exec);
      if (r.cost && !seen.has(r.cost)) {
        seen.add(r.cost);
        costs.push({ ...r.cost, note: `${capability}${r.cost.note ? ` — ${r.cost.note}` : ""}` });
      }
      return r;
    };
    emit({ type: "node.started", message: `${nr.node_id}: started (attempt ${nr.attempt}/${nr.max_attempts})`, runId: run.id, nodeRunId: nr.id, projectId: run.project_id });
    try {
      const inputs = this.resolveInputs(graph, nr.node_id, this.nodeRuns(run.id));
      const params = def.params.parse(node.params ?? {});
      if (!def.run) throw new AdapterError("UNSUPPORTED", `${node.type} has no executor`);
      const result = await def.run({ params, inputs, exec, call });
      if (result.cost && !seen.has(result.cost)) costs.push(result.cost);
      if (controller.signal.aborted) throw new AdapterError("CANCELLED", "cancelled");

      const parents = Object.values(inputs).flat().map((v) => v.assetId).filter((x): x is string => !!x);
      const outputs: Record<string, OutVal[]> = {};
      for (const art of result.artifacts) {
        const a = await registerFile(art.file, {
          projectId: run.project_id,
          kind: art.kind,
          label: art.label ?? `${node.label ?? def.label} · ${art.port}`,
          metadata: art.metadata,
          parents,
          provenance: { nodeType: node.type, nodeId: node.id, runId: run.id, nodeRunId: nr.id, capability: def.capability, attempt: nr.attempt, params },
          nodeRunId: nr.id,
          sceneId: node.sceneId ?? null,
          move: true,
        });
        (outputs[art.port] ??= []).push({ assetId: a.id });
        if (node.sceneId) {
          db.prepare("UPDATE scenes SET selected_asset_id = ?, status = CASE WHEN status IN ('draft','generating','failed') THEN 'review' ELSE status END, updated_at = ? WHERE id = ?").run(a.id, Date.now(), node.sceneId);
        }
      }
      for (const [portName, v] of Object.entries(result.values ?? {})) {
        if (outputs[portName]) continue;
        const list = Array.isArray(v) && def.outputs.find((o) => o.name === portName)?.multiple ? v : [v];
        outputs[portName] = list.map((x) => (x && typeof x === "object" && "assetId" in (x as object) && typeof (x as { assetId: unknown }).assetId === "string" ? { assetId: (x as { assetId: string }).assetId } : { value: x }));
      }
      let nodeCost = 0;
      for (const c of costs) {
        recordCost({ projectId: run.project_id, runId: run.id, nodeRunId: nr.id, provider: (c.note ?? def.capability ?? "engine").split(".")[0], operation: node.type, kind: "actual", amountUsd: c.usd, known: c.known, unit: c.unit, quantity: c.quantity, tokensIn: c.tokensIn, tokensOut: c.tokensOut, note: c.note });
        if (c.known && c.usd) nodeCost += c.usd;
      }
      if (isPaidNode(def, params, inputs) && costs.length === 0)
        recordCost({ projectId: run.project_id, runId: run.id, nodeRunId: nr.id, provider: def.capability?.split(".")[0] ?? "unknown", operation: node.type, kind: "actual", amountUsd: null, known: false, note: "provider did not report a price" });
      tx(db, () => {
        db.prepare("UPDATE node_runs SET status='completed', outputs_json=?, cost_usd=?, progress=1, progress_message='done', finished_at=?, error_json=NULL WHERE id=?").run(JSON.stringify(outputs), nodeCost, Date.now(), nr.id);
        if (nodeCost) db.prepare("UPDATE runs SET spent_usd = spent_usd + ? WHERE id=?").run(nodeCost, run.id);
      });
      emit({ type: "node.completed", message: `${nr.node_id}: completed${result.artifacts.length ? ` (${result.artifacts.length} asset${result.artifacts.length > 1 ? "s" : ""})` : ""}`, runId: run.id, nodeRunId: nr.id, projectId: run.project_id });
    } catch (raw) {
      const err = normalizeError(raw);
      const cancelled = controller.signal.aborted || err.code === "CANCELLED";
      const userCancelled = (db.prepare("SELECT cancel_requested FROM runs WHERE id=?").get(run.id) as { cancel_requested: number }).cancel_requested === 1;
      if (cancelled && this.stopped && !userCancelled) {
        // Worker shutdown, not a user cancel: give the attempt back and re-queue for the next worker.
        db.prepare("UPDATE node_runs SET status='queued', attempt=MAX(0, attempt-1), worker_id=NULL, next_attempt_at=0, progress_message='interrupted by worker shutdown' WHERE id=?").run(nr.id);
        emit({ level: "warn", type: "node.interrupted", message: `${nr.node_id}: interrupted by worker shutdown; will resume`, runId: run.id, nodeRunId: nr.id, projectId: run.project_id });
        return;
      }
      for (const c of costs) recordCost({ projectId: run.project_id, runId: run.id, nodeRunId: nr.id, provider: (c.note ?? "engine").split(".")[0], operation: node.type, kind: "actual", amountUsd: c.usd, known: c.known, unit: c.unit, quantity: c.quantity, tokensIn: c.tokensIn, tokensOut: c.tokensOut, note: `${c.note ?? ""} (node later failed)` });
      if (cancelled) {
        db.prepare("UPDATE node_runs SET status='cancelled', error_json=?, finished_at=? WHERE id=?").run(JSON.stringify(err.toJSON()), Date.now(), nr.id);
        emit({ level: "warn", type: "node.cancelled", message: `${nr.node_id}: cancelled`, runId: run.id, nodeRunId: nr.id, projectId: run.project_id });
      } else if (err.retryable && nr.attempt < nr.max_attempts) {
        const base = node.retry?.backoffMs ?? 2000;
        const delay = Math.min(10 * 60_000, base * 2 ** (nr.attempt - 1)) * (0.8 + Math.random() * 0.4);
        db.prepare("UPDATE node_runs SET status='queued', error_json=?, next_attempt_at=?, progress_message=? WHERE id=?").run(JSON.stringify(err.toJSON()), Date.now() + delay, `retrying in ${Math.round(delay / 1000)}s`, nr.id);
        emit({ level: "warn", type: "node.retry", message: `${nr.node_id}: ${err.code} — ${err.message}; retry ${nr.attempt + 1}/${nr.max_attempts} in ${Math.round(delay / 1000)}s`, runId: run.id, nodeRunId: nr.id, projectId: run.project_id });
      } else {
        db.prepare("UPDATE node_runs SET status='failed', error_json=?, finished_at=? WHERE id=?").run(JSON.stringify(err.toJSON()), Date.now(), nr.id);
        if (node.sceneId) db.prepare("UPDATE scenes SET status='failed', updated_at=? WHERE id=?").run(Date.now(), node.sceneId);
        emit({ level: "error", type: "node.failed", message: `${nr.node_id}: ${err.code} — ${err.message}`, runId: run.id, nodeRunId: nr.id, projectId: run.project_id });
      }
    }
  }
}

export function evalCondition(value: unknown, p: { path: string; op: "eq" | "ne" | "gt" | "lt" | "exists" | "truthy"; value?: unknown }): boolean {
  let cur: unknown = value;
  for (const key of p.path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean)) {
    if (cur && typeof cur === "object") cur = (cur as Record<string, unknown>)[key];
    else {
      cur = undefined;
      break;
    }
  }
  switch (p.op) {
    case "exists":
      return cur !== undefined && cur !== null;
    case "truthy":
      return !!cur;
    case "eq":
      return stableStringify(cur) === stableStringify(p.value);
    case "ne":
      return stableStringify(cur) !== stableStringify(p.value);
    case "gt":
      return typeof cur === "number" && typeof p.value === "number" && cur > p.value;
    case "lt":
      return typeof cur === "number" && typeof p.value === "number" && cur < p.value;
  }
}
