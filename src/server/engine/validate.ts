import type { Graph, PortType, ValidationIssue } from "@/shared/schema";
import { GraphSchema } from "@/shared/schema";
import { readyCapabilities } from "../adapters/registry";
import { getNodeDef, nodeAvailability } from "./node-types";

export function portCompatible(from: PortType, to: PortType): boolean {
  if (from === to || from === "any" || to === "any") return true;
  // A storyboard is structured JSON; JSON consumers may read it.
  if (from === "storyboard" && to === "json") return true;
  if (from === "text" && to === "json") return false;
  return false;
}

/** Kahn's algorithm. Returns topological order or the nodes left in a cycle. */
export function topoSort(graph: Graph): { order: string[]; cycle: string[] } {
  const indeg = new Map(graph.nodes.map((n) => [n.id, 0]));
  const out = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) {
    if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    out.get(e.source)!.push(e.target);
  }
  const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const t of out.get(id) ?? []) {
      indeg.set(t, indeg.get(t)! - 1);
      if (indeg.get(t) === 0) queue.push(t);
    }
  }
  const cycle = [...indeg].filter(([id]) => !order.includes(id)).map(([id]) => id);
  return { order, cycle };
}

export function downstreamOf(graph: Graph, ids: string[]): Set<string> {
  const out = new Map<string, string[]>();
  for (const e of graph.edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const seen = new Set<string>(ids);
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop()!;
    for (const t of out.get(id) ?? []) if (!seen.has(t)) (seen.add(t), stack.push(t));
  }
  return seen;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  graph?: Graph;
  order: string[];
}

export function validateGraph(input: unknown, opts: { checkAvailability?: boolean } = {}): ValidationResult {
  const issues: ValidationIssue[] = [];
  const parsed = GraphSchema.safeParse(input);
  if (!parsed.success) {
    for (const i of parsed.error.issues) issues.push({ level: "error", code: "schema", message: `${i.path.join(".")}: ${i.message}` });
    return { ok: false, issues, order: [] };
  }
  const graph = parsed.data;
  const ready = opts.checkAvailability === false ? undefined : readyCapabilities();
  const nodes = new Map<string, (typeof graph.nodes)[number]>();
  for (const n of graph.nodes) {
    if (nodes.has(n.id)) issues.push({ level: "error", code: "duplicate_node", message: `duplicate node id ${n.id}`, nodeId: n.id });
    nodes.set(n.id, n);
  }
  const edgeIds = new Set<string>();
  for (const e of graph.edges) {
    if (edgeIds.has(e.id)) issues.push({ level: "error", code: "duplicate_edge", message: `duplicate edge id ${e.id}`, edgeId: e.id });
    edgeIds.add(e.id);
  }

  for (const n of graph.nodes) {
    const def = getNodeDef(n.type);
    if (!def) {
      issues.push({ level: "error", code: "unknown_type", message: `unknown node type "${n.type}"`, nodeId: n.id });
      continue;
    }
    const p = def.params.safeParse(n.params ?? {});
    if (!p.success)
      for (const i of p.error.issues) issues.push({ level: "error", code: "params", message: `${n.label ?? n.id}: ${i.path.join(".") || "params"} — ${i.message}`, nodeId: n.id });
    if (ready) {
      const av = nodeAvailability(def, ready);
      if (!av.available) issues.push({ level: "error", code: "unavailable", message: `${n.label ?? def.label}: ${av.reason}`, nodeId: n.id });
    }
    // Required inputs
    for (const inp of def.inputs) {
      const incoming = graph.edges.filter((e) => e.target === n.id && e.targetHandle === inp.name);
      if (!inp.optional && incoming.length === 0) {
        // Some nodes accept the value as a param instead of an edge.
        const paramAlt = (inp.name === "brief" || inp.name === "script") && typeof (n.params as Record<string, unknown>)?.[inp.name === "brief" ? "brief" : "text"] === "string";
        if (!paramAlt) issues.push({ level: "error", code: "missing_input", message: `${n.label ?? def.label}: input "${inp.name}" is not connected`, nodeId: n.id });
      }
      if (!inp.multiple && incoming.length > 1) issues.push({ level: "error", code: "too_many_inputs", message: `${n.label ?? def.label}: input "${inp.name}" accepts one connection`, nodeId: n.id });
    }
  }

  for (const e of graph.edges) {
    const s = nodes.get(e.source);
    const t = nodes.get(e.target);
    if (!s || !t) {
      issues.push({ level: "error", code: "dangling_edge", message: `edge ${e.id} references a missing node`, edgeId: e.id });
      continue;
    }
    if (e.source === e.target) issues.push({ level: "error", code: "self_loop", message: `edge ${e.id} connects a node to itself`, edgeId: e.id });
    const sd = getNodeDef(s.type);
    const td = getNodeDef(t.type);
    if (!sd || !td) continue;
    const sp = sd.outputs.find((o) => o.name === e.sourceHandle);
    const tp = td.inputs.find((i) => i.name === e.targetHandle);
    if (!sp) issues.push({ level: "error", code: "bad_port", message: `${sd.label} has no output "${e.sourceHandle}"`, edgeId: e.id });
    if (!tp) issues.push({ level: "error", code: "bad_port", message: `${td.label} has no input "${e.targetHandle}"`, edgeId: e.id });
    if (sp && tp && !portCompatible(sp.type, tp.type))
      issues.push({ level: "error", code: "type_mismatch", message: `${sd.label}.${sp.name} (${sp.type}) → ${td.label}.${tp.name} (${tp.type}) is not compatible`, edgeId: e.id });
  }

  const { order, cycle } = topoSort(graph);
  if (cycle.length) issues.push({ level: "error", code: "cycle", message: `cycle detected through: ${cycle.join(", ")}` });
  if (graph.nodes.length === 0) issues.push({ level: "error", code: "empty", message: "graph has no nodes" });

  // Warnings: dead-end non-export nodes are fine, but disconnected nodes are suspicious.
  for (const n of graph.nodes) {
    const connected = graph.edges.some((e) => e.source === n.id || e.target === n.id);
    if (!connected && graph.nodes.length > 1) issues.push({ level: "warning", code: "isolated", message: `${n.label ?? n.id} is not connected`, nodeId: n.id });
  }
  return { ok: !issues.some((i) => i.level === "error"), issues, graph, order };
}
