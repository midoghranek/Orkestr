import { beforeAll, describe, expect, it } from "vitest";
import { edge, freshEnv, mock } from "../helpers";
import { closeDb } from "@/server/db";
import { validateGraph, topoSort, downstreamOf } from "@/server/engine/validate";
import { evalCondition } from "@/server/engine/engine";

describe("graph validation", () => {
  beforeAll(() => {
    freshEnv("validate");
    closeDb();
  });

  it("accepts a valid DAG", () => {
    const r = validateGraph({ version: 1, nodes: [mock("a"), mock("b")], edges: [edge("a", "b")] });
    expect(r.ok).toBe(true);
    expect(r.order).toEqual(["a", "b"]);
  });

  it("rejects cycles", () => {
    const r = validateGraph({ version: 1, nodes: [mock("a"), mock("b")], edges: [edge("a", "b"), edge("b", "a")] });
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain("cycle");
  });

  it("rejects unknown node types, bad ports and dangling edges", () => {
    const r = validateGraph({
      version: 1,
      nodes: [mock("a"), { id: "x", type: "does.not.exist", params: {}, position: { x: 0, y: 0 } }],
      edges: [edge("a", "ghost"), { id: "bp", source: "a", sourceHandle: "nope", target: "a", targetHandle: "in" }],
    });
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain("unknown_type");
    expect(codes).toContain("dangling_edge");
    expect(codes).toContain("bad_port");
    expect(codes).toContain("self_loop");
  });

  it("rejects incompatible port types", () => {
    const r = validateGraph({
      version: 1,
      nodes: [
        { id: "t", type: "logic.text", params: { text: "hi" }, position: { x: 0, y: 0 } },
        { id: "enc", type: "video.encode", params: {}, position: { x: 0, y: 0 } },
      ],
      edges: [{ id: "e", source: "t", sourceHandle: "text", target: "enc", targetHandle: "video" }],
    });
    expect(r.issues.map((i) => i.code)).toContain("type_mismatch");
  });

  it("reports missing required inputs and invalid params", () => {
    const r = validateGraph({
      version: 1,
      nodes: [{ id: "enc", type: "video.encode", params: { crf: 99 }, position: { x: 0, y: 0 } }],
      edges: [],
    });
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain("missing_input");
    expect(codes).toContain("params");
  });

  it("blocks nodes whose capability is not verified on this machine", () => {
    const r = validateGraph({ version: 1, nodes: [{ id: "gen", type: "image.generate", params: { prompt: "a cafe" }, position: { x: 0, y: 0 } }], edges: [] });
    const issue = r.issues.find((i) => i.code === "unavailable");
    expect(issue?.message).toMatch(/No verified generation provider/);
  });

  it("rejects malformed graphs (schema) and dangerous ids", () => {
    expect(validateGraph({ nodes: "nope" }).ok).toBe(false);
    expect(validateGraph({ version: 1, nodes: [mock("../../etc")], edges: [] }).ok).toBe(false);
  });

  it("computes topological order and downstream sets", () => {
    const g = { version: 1 as const, nodes: [mock("a"), mock("b"), mock("c"), mock("d")], edges: [edge("a", "b"), edge("b", "c"), edge("a", "d")] };
    expect(topoSort(g).order[0]).toBe("a");
    expect([...downstreamOf(g, ["b"])].sort()).toEqual(["b", "c"]);
  });
});

describe("conditions", () => {
  it("evaluates paths and operators without code execution", () => {
    const v = { pass: true, facts: { width: 1920 }, checks: [{ pass: false }] };
    expect(evalCondition(v, { path: "pass", op: "truthy" })).toBe(true);
    expect(evalCondition(v, { path: "facts.width", op: "eq", value: 1920 })).toBe(true);
    expect(evalCondition(v, { path: "facts.width", op: "gt", value: 1000 })).toBe(true);
    expect(evalCondition(v, { path: "checks[0].pass", op: "eq", value: false })).toBe(true);
    expect(evalCondition(v, { path: "missing.deep", op: "exists" })).toBe(false);
  });
});
