import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { edge, freshEnv, mock } from "../helpers";
import { closeDb, getDb } from "@/server/db";
import { createProject, createWorkflow } from "@/server/projects";
import { Engine, createRun, requestCancel, rerunNodes, retryFailed } from "@/server/engine/engine";
import { mockState, resetMock } from "@/server/adapters/mock";
import type { Graph } from "@/shared/schema";

function setup(graph: Graph) {
  const p = createProject({ name: "Test" });
  const wf = createWorkflow(p.id, "wf", graph);
  return { project: p, wf };
}

const nodeStatus = (runId: string) =>
  Object.fromEntries((getDb().prepare("SELECT node_id, status FROM node_runs WHERE run_id = ?").all(runId) as { node_id: string; status: string }[]).map((r) => [r.node_id, r.status]));

describe("workflow engine", () => {
  let engine: Engine;
  beforeEach(() => {
    freshEnv("engine");
    closeDb();
    resetMock();
    engine = new Engine({ concurrency: 4, pollMs: 10, staleMs: 200 });
  });
  afterEach(async () => {
    await engine.stop();
    closeDb();
  });

  it("runs a linear chain and propagates outputs", async () => {
    const { wf } = setup({ version: 1, nodes: [mock("a", { text: "A" }), mock("b", { text: "B" }), mock("c", { text: "C" })], edges: [edge("a", "b"), edge("b", "c")] });
    const run = createRun(wf.id);
    expect(await engine.runToCompletion(run)).toBe("completed");
    expect(mockState.executions).toEqual(["a", "b", "c"]);
    const out = getDb().prepare("SELECT outputs_json FROM node_runs WHERE run_id=? AND node_id='c'").get(run) as { outputs_json: string };
    const assetId = JSON.parse(out.outputs_json).out[0].assetId;
    const asset = getDb().prepare("SELECT path, parents_json FROM assets WHERE id=?").get(assetId) as { path: string; parents_json: string };
    expect((await import("node:fs")).readFileSync(asset.path, "utf8")).toBe("C<B<A>>");
    expect(JSON.parse(asset.parents_json)).toHaveLength(1); // lineage: c's output derives from b's output
  });

  it("runs independent branches in parallel", async () => {
    resetMock({ delayMs: 150 });
    const { wf } = setup({ version: 1, nodes: [mock("x"), mock("y"), mock("z"), mock("join")], edges: [edge("x", "join"), edge("y", "join"), edge("z", "join")] });
    const run = createRun(wf.id);
    const t = Date.now();
    expect(await engine.runToCompletion(run)).toBe("completed");
    const rows = getDb().prepare("SELECT node_id, started_at, finished_at FROM node_runs WHERE run_id=? AND node_id IN ('x','y','z')").all(run) as { started_at: number; finished_at: number }[];
    const overlap = Math.min(...rows.map((r) => r.finished_at)) > Math.max(...rows.map((r) => r.started_at));
    expect(overlap).toBe(true);
    expect(Date.now() - t).toBeLessThan(150 * 4 + 400); // well under fully serial time (4 × 150ms) + overhead
  });

  it("retries transient failures with backoff and succeeds", async () => {
    resetMock({ failTimes: { flaky: 2 } });
    const { wf } = setup({ version: 1, nodes: [mock("flaky")], edges: [] });
    const run = createRun(wf.id);
    expect(await engine.runToCompletion(run)).toBe("completed");
    expect(mockState.calls.flaky).toBe(3);
    const nr = getDb().prepare("SELECT attempt FROM node_runs WHERE run_id=?").get(run) as { attempt: number };
    expect(nr.attempt).toBe(3);
  });

  it("fails after max attempts and skips dependents, keeping independent work", async () => {
    resetMock({ failAlways: ["s4"] });
    const scenes = ["s1", "s2", "s3", "s4"].map((s) => mock(s));
    const { wf } = setup({ version: 1, nodes: [...scenes, mock("compose"), mock("export")], edges: [...scenes.map((s) => edge(s.id, "compose")), edge("compose", "export")] });
    const run = createRun(wf.id);
    expect(await engine.runToCompletion(run)).toBe("failed");
    expect(nodeStatus(run)).toMatchObject({ s1: "completed", s2: "completed", s3: "completed", s4: "failed", compose: "skipped", export: "skipped" });

    // Fix the cause, then retry in place: only scene 4 and its dependents execute again.
    resetMock();
    retryFailed(run);
    expect(await engine.runToCompletion(run)).toBe("completed");
    expect(mockState.executions.sort()).toEqual(["compose", "export", "s4"]);
  });

  it("reuses cached results for identical inputs and supports forced selective reruns", async () => {
    const g: Graph = { version: 1, nodes: [mock("a"), mock("b"), mock("c")], edges: [edge("a", "b"), edge("b", "c")] };
    const { wf } = setup(g);
    const r1 = createRun(wf.id);
    await engine.runToCompletion(r1);
    resetMock();
    const r2 = createRun(wf.id);
    expect(await engine.runToCompletion(r2)).toBe("completed");
    expect(mockState.executions).toEqual([]); // everything reused
    const cached = getDb().prepare("SELECT COUNT(*) c FROM node_runs WHERE run_id=? AND cached_from IS NOT NULL").get(r2) as { c: number };
    expect(cached.c).toBe(3);

    // Force b: it re-executes; it produces the same bytes, so c's signature is unchanged and c is reused.
    resetMock();
    const r3 = rerunNodes(r2, ["b"]);
    expect(await engine.runToCompletion(r3)).toBe("completed");
    expect(mockState.executions).toEqual(["b"]);
  });

  it("invalidates downstream when an upstream param changes", async () => {
    const { wf } = setup({ version: 1, nodes: [mock("a", { text: "v1" }), mock("b")], edges: [edge("a", "b")] });
    await engine.runToCompletion(createRun(wf.id));
    const { saveWorkflow } = await import("@/server/projects");
    saveWorkflow(wf.id, { graph: { version: 1, nodes: [mock("a", { text: "v2" }), mock("b")], edges: [edge("a", "b")] } });
    resetMock();
    await engine.runToCompletion(createRun(wf.id));
    expect(mockState.executions).toEqual(["a", "b"]);
  });

  it("cancels a running workflow", async () => {
    resetMock({ delayMs: 5000 });
    const { wf } = setup({ version: 1, nodes: [mock("slow"), mock("after")], edges: [edge("slow", "after")] });
    const run = createRun(wf.id);
    const p = engine.runToCompletion(run, 10_000);
    await new Promise((r) => setTimeout(r, 150));
    requestCancel(run);
    expect(await p).toBe("cancelled");
    expect(nodeStatus(run)).toMatchObject({ slow: "cancelled", after: "cancelled" });
  });

  it("recovers jobs orphaned by a crashed worker", async () => {
    const { wf } = setup({ version: 1, nodes: [mock("job")], edges: [] });
    const run = createRun(wf.id);
    // Simulate another worker that claimed the job and died.
    getDb().prepare("UPDATE node_runs SET status='running', attempt=1, worker_id='dead-worker', heartbeat_at=? WHERE run_id=?").run(Date.now() - 60_000, run);
    getDb().prepare("UPDATE runs SET status='running' WHERE id=?").run(run);
    expect(await engine.runToCompletion(run)).toBe("completed");
    const ev = getDb().prepare("SELECT COUNT(*) c FROM events WHERE type='node.recovered' AND run_id=?").get(run) as { c: number };
    expect(ev.c).toBe(1);
  });

  it("requires approval for paid steps and honours rejection", async () => {
    const { wf } = setup({ version: 1, nodes: [mock("paid", { paid: true }), mock("next")], edges: [edge("paid", "next")] });
    const run = createRun(wf.id);
    expect(await engine.runToCompletion(run)).toBe("waiting_approval");
    expect(mockState.executions).toEqual([]); // nothing was spent
    const ap = getDb().prepare("SELECT id, amount_usd, amount_known FROM approvals WHERE run_id=? AND status='pending'").get(run) as { id: string; amount_usd: number; amount_known: number };
    expect(ap.amount_usd).toBe(0.5);
    getDb().prepare("UPDATE approvals SET status='approved', decided_at=? WHERE id=?").run(Date.now(), ap.id);
    expect(await engine.runToCompletion(run)).toBe("completed");
    const spent = getDb().prepare("SELECT spent_usd FROM runs WHERE id=?").get(run) as { spent_usd: number };
    expect(spent.spent_usd).toBeCloseTo(0.5);

    const run2 = createRun(wf.id, { forceNodes: ["paid"] });
    await engine.runToCompletion(run2);
    const ap2 = getDb().prepare("SELECT id FROM approvals WHERE run_id=? AND status='pending'").get(run2) as { id: string };
    getDb().prepare("UPDATE approvals SET status='rejected', decided_at=? WHERE id=?").run(Date.now(), ap2.id);
    expect(await engine.runToCompletion(run2)).toBe("failed");
    expect(nodeStatus(run2)).toMatchObject({ paid: "failed", next: "skipped" });
  });

  it("auto-approves paid steps inside a preauthorized budget only", async () => {
    const { wf } = setup({ version: 1, nodes: [mock("p1", { paid: true }), mock("p2", { paid: true })], edges: [] });
    const run = createRun(wf.id, { preauthorizedUsd: 0.6 });
    expect(await engine.runToCompletion(run)).toBe("waiting_approval");
    // One fits in $0.60, the second would exceed it and must wait.
    expect(mockState.executions).toHaveLength(1);
  });

  it("gates on creative approval nodes", async () => {
    const { wf } = setup({
      version: 1,
      nodes: [mock("draft"), { id: "gate", type: "logic.approval", params: { title: "Approve draft" }, position: { x: 0, y: 0 } }, mock("final")],
      edges: [edge("draft", "gate"), edge("gate", "final", "out", "in")],
    });
    const run = createRun(wf.id);
    expect(await engine.runToCompletion(run)).toBe("waiting_approval");
    const ap = getDb().prepare("SELECT id, kind FROM approvals WHERE run_id=?").get(run) as { id: string; kind: string };
    expect(ap.kind).toBe("creative");
    getDb().prepare("UPDATE approvals SET status='approved' WHERE id=?").run(ap.id);
    expect(await engine.runToCompletion(run)).toBe("completed");
  });

  it("routes condition branches and skips the branch not taken", async () => {
    const { wf } = setup({
      version: 1,
      nodes: [
        { id: "facts", type: "logic.text", params: { text: "x" }, position: { x: 0, y: 0 } },
        { id: "cond", type: "logic.condition", params: { path: "ok", op: "eq", value: true }, position: { x: 0, y: 0 } },
        mock("yes"),
        mock("no"),
      ],
      edges: [],
    });
    // Feed a JSON value: use a select node over a merge to turn text into json-ish input via value path.
    const g = wf.graph;
    g.nodes[0] = { id: "facts", type: "logic.merge", params: {}, position: { x: 0, y: 0 } };
    g.nodes.unshift({ id: "seed", type: "logic.text", params: { text: "seed" }, position: { x: 0, y: 0 } });
    const { saveWorkflow } = await import("@/server/projects");
    // A json port is needed for conditions; logic.merge outputs `any`, which is compatible.
    saveWorkflow(wf.id, { graph: { ...g, edges: [edge("seed", "facts", "text", "in"), edge("facts", "cond", "out", "in"), edge("cond", "yes", "true", "in"), edge("cond", "no", "false", "in")] } });
    const run = createRun(wf.id);
    expect(await engine.runToCompletion(run)).toBe("completed");
    // merge output is ["seed"]: path "ok" is undefined ⇒ false branch.
    expect(nodeStatus(run)).toMatchObject({ cond: "completed", yes: "skipped", no: "completed" });
  });

  it("re-queues work interrupted by a worker shutdown instead of cancelling it", async () => {
    resetMock({ delayMs: 3000 });
    const { wf } = setup({ version: 1, nodes: [mock("long")], edges: [] });
    const run = createRun(wf.id);
    engine.start();
    await new Promise((r) => setTimeout(r, 300));
    await engine.stop();
    expect(nodeStatus(run).long).toBe("queued");
    resetMock();
    const e2 = new Engine({ concurrency: 2, pollMs: 10 });
    expect(await e2.runToCompletion(run)).toBe("completed");
    await e2.stop();
  });
});
