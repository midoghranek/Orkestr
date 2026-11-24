import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { edge, freshEnv, mock } from "../helpers";
import { closeDb, getDb } from "@/server/db";
import { createProject, createWorkflow } from "@/server/projects";
import { Engine, createRun } from "@/server/engine/engine";
import { resetMock } from "@/server/adapters/mock";
import { decideApproval, listApprovals } from "@/server/views";
import { processProductions, refine, restoreVersion, startCreation, workspace } from "@/server/producer";

describe("production coordinator", () => {
  beforeEach(() => {
    freshEnv("producer");
    closeDb();
  });
  afterEach(() => closeDb());

  it("turns a request into a reviewable direction with the free planner, no tools or website needed", async () => {
    const r = startCreation({ prompt: "Announce our new seasonal menu, 12 seconds", planner: "recipe" });
    expect(r.intent.recipeId).toBe("type-promo");
    await processProductions();
    const w = workspace(r.project.id)!;
    expect(w.production?.status).toBe("direction");
    expect(w.plan?.deliverables[0].durationS).toBe(12);
    expect(w.nextAction.kind).toBe("review-direction");
    // Missing copy is asked for, never invented.
    expect(w.creative?.issues.some((i) => i.id.startsWith("write-"))).toBe(true);
  });

  it("refines with plain language, keeps version history, and restores", async () => {
    const r = startCreation({ prompt: "Announce our new seasonal menu", planner: "recipe" });
    const before = workspace(r.project.id)!;
    const res = await refine(r.productionId, { instruction: "make it 20 seconds and bigger text" });
    expect(res.usedAi).toBe(false);
    expect(res.rerendering).toBe(false); // nothing produced yet: the change updates the direction only
    const after = workspace(r.project.id)!;
    expect(after.plan?.deliverables[0].durationS).toBe(20);
    expect(after.plan?.style.textScale).toBeGreaterThan(1);
    expect(after.versions.length).toBeGreaterThan(before.versions.length);
    restoreVersion(r.productionId, before.plan!.id);
    expect(workspace(r.project.id)!.plan?.deliverables[0].durationS).toBe(before.plan?.deliverables[0].durationS);
  });

  it("asks before using the AI for creative rewrites it cannot do locally", async () => {
    const r = startCreation({ prompt: "Announce our new seasonal menu", planner: "recipe" });
    await expect(refine(r.productionId, { instruction: "Rewrite it in Egyptian Arabic" })).rejects.toThrow(/AI Director/);
  });

  it("only re-renders automatically when every on-screen line was already confirmed", async () => {
    const { textAlreadyConfirmed } = await import("@/server/producer");
    const { getProject, updateProject } = await import("@/server/projects");
    const r = startCreation({ prompt: "Announce our new seasonal menu", planner: "recipe" });
    const plan = workspace(r.project.id)!.plan!;
    const lines = plan.scenes.map((s) => s.onScreenText.replace(/\n/g, " ").trim()).filter((l) => l.length > 2);
    expect(textAlreadyConfirmed(getProject(r.project.id)!, plan)).toBe(false);
    updateProject(r.project.id, { settings: { verifiedClaims: lines } as never });
    expect(textAlreadyConfirmed(getProject(r.project.id)!, plan)).toBe(true);
    const edited = { ...plan, scenes: plan.scenes.map((s, i) => (i === 1 ? { ...s, onScreenText: "Brand new claim" } : s)) };
    expect(textAlreadyConfirmed(getProject(r.project.id)!, edited)).toBe(false);
  });

  it("rejects non-http websites", () => {
    expect(() => startCreation({ prompt: "Video", url: "file:///etc/passwd", planner: "recipe" })).toThrow(/http/);
  });
});

describe("approvals", () => {
  let engine: Engine;
  beforeEach(() => {
    freshEnv("approvals");
    closeDb();
    resetMock();
    engine = new Engine({ concurrency: 2, pollMs: 10, staleMs: 200 });
  });
  afterEach(async () => {
    await engine.stop();
    closeDb();
  });

  it("carries over a decision on identical content, but asks again when content changes", async () => {
    const p = createProject({ name: "A" });
    const gate = { id: "gate", type: "logic.approval", params: { title: "OK?", instructions: "" }, position: { x: 0, y: 0 } };
    const wf = createWorkflow(p.id, "wf", { version: 1, nodes: [mock("a", { text: "A" }), gate], edges: [edge("a", "gate")] });
    const run1 = createRun(wf.id);
    engine.start();
    await waitFor(() => listApprovals({ runId: run1, status: "pending" }).length === 1);
    decideApproval(listApprovals({ runId: run1, status: "pending" })[0].id, "approved");
    expect(await engine.runToCompletion(run1)).toBe("completed");

    // Same content: no new question for the person.
    const run2 = createRun(wf.id);
    expect(await engine.runToCompletion(run2)).toBe("completed");
    expect(listApprovals({ runId: run2 })[0].decidedNote).toMatch(/Carried over/);

    // Changed content: a fresh decision is required.
    getDb().prepare("UPDATE workflows SET graph_json = ? WHERE id = ?").run(JSON.stringify({ version: 1, nodes: [mock("a", { text: "B" }), gate], edges: [edge("a", "gate")] }), wf.id);
    const run3 = createRun(wf.id);
    await waitFor(() => listApprovals({ runId: run3, status: "pending" }).length === 1);
  });
});

async function waitFor(fn: () => boolean, ms = 10_000) {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
}
