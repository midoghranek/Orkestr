"use client";

import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { AlertTriangle, Check, LayoutGrid, Lock, Play, RotateCcw, Save, Square, Trash2 } from "lucide-react";
import type { Graph, NodeTypeInfo, PortType, ValidationIssue } from "@/shared/schema";
import { ago, api, fmtUsd, useApi, useEvents, type OrkEvent } from "@/lib/api";
import { AssetPreview, Button, cn, Field, Input, Pill, Progress, Select, StatusBadge, toast, type AssetLite } from "@/components/ui";
import { OrkNode, PORT_COLORS, type OrkNodeData } from "@/components/flow/ork-node";
import { ParamsForm } from "@/components/flow/params-form";
import { useProject } from "@/components/project-context";

type FNode = Node<OrkNodeData>;
interface WorkflowResp {
  workflow: { id: string; projectId: string; name: string; graph: Graph; version: number; source: string };
  validation: { ok: boolean; issues: ValidationIssue[] };
}
interface NodeRunView {
  id: string;
  nodeId: string;
  nodeType: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  progress: number;
  progressMessage: string | null;
  error: { code: string; message: string } | null;
  estimate: { usd: number | null; known: boolean; basis: string; quantity?: number; unit?: string } | null;
  costUsd: number;
  cachedFrom: string | null;
  outputs: Record<string, ({ assetId: string } | { value: unknown })[]>;
  startedAt: number | null;
  finishedAt: number | null;
}
interface RunDetail {
  run: { id: string; status: string; progress: number; spentUsd: number; preauthorizedUsd: number; error: string | null; createdAt: number; counts: Record<string, number> };
  nodes: NodeRunView[];
  approvals: { id: string; status: string; title: string; nodeId?: string; kind: string; amountUsd: number | null; amountKnown: boolean }[];
}

const nodeTypes = { ork: OrkNode };
const FAMILY_ORDER = ["ai", "image", "video", "audio", "production", "logic"] as const;
const FAMILY_LABEL: Record<string, string> = { ai: "AI", image: "Image", video: "Video", audio: "Audio", production: "Production", logic: "Logic" };

function compatible(a: PortType, b: PortType) {
  return a === b || a === "any" || b === "any" || (a === "storyboard" && b === "json");
}

function toGraph(nodes: FNode[], edges: Edge[]): Graph {
  return {
    version: 1,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.type,
      label: n.data.label || undefined,
      params: n.data.params ?? {},
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      ...(n.data.sceneId ? { sceneId: n.data.sceneId } : {}),
      ...(n.data.retry && Object.keys(n.data.retry).length ? { retry: n.data.retry } : {}),
    })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? "", target: e.target, targetHandle: e.targetHandle ?? "" })),
  };
}

function layout(nodes: FNode[], edges: Edge[]): FNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 30, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => g.setNode(n.id, { width: 230, height: (n.measured?.height ?? 120) + 10 }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return { ...n, position: { x: p.x - 115, y: p.y - (n.measured?.height ?? 120) / 2 } };
  });
}

export default function FlowEditorPage() {
  return (
    <ReactFlowProvider>
      <Editor />
    </ReactFlowProvider>
  );
}

function Editor() {
  const { wfId } = useParams<{ wfId: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { data: project } = useProject();
  const rf = useReactFlow();
  const types = useApi<NodeTypeInfo[]>("/api/node-types");
  const wf = useApi<WorkflowResp>(`/api/workflows/${wfId}`);
  const [nodes, setNodes, onNodesChange] = useNodesState<FNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("");
  const [version, setVersion] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(search.get("run"));
  const [preauth, setPreauth] = useState("0");
  const [busy, setBusy] = useState<string | null>(null);
  const [bottom, setBottom] = useState<"issues" | "log">("issues");
  const loadedRef = useRef(false);
  const byType = useMemo(() => new Map((types.data ?? []).map((t) => [t.type, t])), [types.data]);

  const runs = useApi<{ id: string; status: string; createdAt: number }[]>(`/api/runs?workflowId=${wfId}&limit=30`, { events: (e) => e.type.startsWith("run.") });
  const run = useApi<RunDetail>(runId ? `/api/runs/${runId}` : null, { events: (e) => e.run_id === runId && !e.type.startsWith("node.log"), refreshMs: 4000 });

  // Load the workflow once node types are known.
  useEffect(() => {
    if (!wf.data || !types.data || loadedRef.current) return;
    loadedRef.current = true;
    const g = wf.data.workflow.graph;
    setName(wf.data.workflow.name);
    setVersion(wf.data.workflow.version);
    setIssues(wf.data.validation.issues);
    setNodes(g.nodes.map((n) => ({ id: n.id, type: "ork", position: n.position, data: { type: n.type, label: n.label, params: n.params, sceneId: n.sceneId, retry: n.retry, info: byType.get(n.type) } })));
    setEdges(g.edges.map((e) => ({ ...e, style: { stroke: PORT_COLORS[byType.get(g.nodes.find((n) => n.id === e.source)?.type ?? "")?.outputs.find((o) => o.name === e.sourceHandle)?.type ?? "any"] } })));
    setTimeout(() => rf.fitView({ padding: 0.15 }), 50);
  }, [wf.data, types.data, byType, setNodes, setEdges, rf]);

  useEffect(() => {
    if (!runId && runs.data?.[0]) setRunId(runs.data[0].id);
  }, [runs.data, runId]);

  // Live validation (debounced) whenever the graph changes.
  const graph = useMemo(() => toGraph(nodes, edges), [nodes, edges]);
  const graphKey = JSON.stringify({ n: graph.nodes.map((n) => [n.id, n.type, n.params, n.label]), e: graph.edges });
  useEffect(() => {
    if (!loadedRef.current) return;
    const t = setTimeout(async () => {
      try {
        const v = await api<{ issues: ValidationIssue[] }>("/api/workflows/validate", { method: "POST", json: graph });
        setIssues(v.issues);
      } catch {
        /* keep last */
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey]);

  // Overlay run state + issues onto nodes.
  useEffect(() => {
    const nrs = new Map((run.data?.nodes ?? []).map((n) => [n.nodeId, n]));
    setNodes((ns) =>
      ns.map((n) => {
        const nr = nrs.get(n.id);
        const firstAsset = nr ? Object.values(nr.outputs).flat().find((o): o is { assetId: string } => "assetId" in o) : undefined;
        const nodeIssues = issues.filter((i) => i.nodeId === n.id && i.level === "error").map((i) => i.message);
        const runData = nr
          ? { status: nr.status, progress: nr.progress, message: nr.progressMessage, attempt: nr.attempt, maxAttempts: nr.maxAttempts, cached: !!nr.cachedFrom, error: nr.error?.message, previewAssetId: firstAsset?.assetId, previewKind: assetKinds.current.get(firstAsset?.assetId ?? "") }
          : undefined;
        if (JSON.stringify(runData) === JSON.stringify(n.data.run) && JSON.stringify(nodeIssues) === JSON.stringify(n.data.issues ?? [])) return n;
        return { ...n, data: { ...n.data, run: runData, issues: nodeIssues } };
      }),
    );
    setEdges((es) => es.map((e) => ({ ...e, animated: nrs.get(e.target)?.status === "running" })));
  }, [run.data, issues, setNodes, setEdges]);

  // Learn output asset kinds for node previews.
  const assetKinds = useRef(new Map<string, string>());
  useEffect(() => {
    const ids = (run.data?.nodes ?? []).flatMap((n) => Object.values(n.outputs).flat()).filter((o): o is { assetId: string } => "assetId" in o).map((o) => o.assetId).filter((id) => !assetKinds.current.has(id));
    if (!ids.length) return;
    void Promise.all(ids.slice(0, 40).map((id) => api<{ asset: AssetLite }>(`/api/assets/${id}`).then((r) => assetKinds.current.set(id, r.asset.kind)).catch(() => undefined))).then(() => setNodes((ns) => [...ns]));
  }, [run.data, setNodes]);

  const markDirty = useCallback(() => setDirty(true), []);

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (c.source === c.target) return false;
      const s = nodes.find((n) => n.id === c.source);
      const t = nodes.find((n) => n.id === c.target);
      const sp = s?.data.info?.outputs.find((o) => o.name === c.sourceHandle);
      const tp = t?.data.info?.inputs.find((i) => i.name === c.targetHandle);
      if (!sp || !tp) return false;
      if (!tp.multiple && edges.some((e) => e.target === c.target && e.targetHandle === c.targetHandle)) return false;
      return compatible(sp.type, tp.type);
    },
    [nodes, edges],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      const s = nodes.find((n) => n.id === c.source);
      const color = PORT_COLORS[s?.data.info?.outputs.find((o) => o.name === c.sourceHandle)?.type ?? "any"];
      setEdges((es) => addEdge({ ...c, id: `e_${c.source}_${c.sourceHandle}_${c.target}_${c.targetHandle}`.slice(0, 64).replace(/[^A-Za-z0-9_.-]/g, "_"), style: { stroke: color } }, es));
      markDirty();
    },
    [nodes, setEdges, markDirty],
  );

  const addNode = useCallback(
    (t: NodeTypeInfo, pos?: { x: number; y: number }) => {
      const base = t.type.split(".").pop()!.replace(/[^A-Za-z0-9_]/g, "_");
      let id = base;
      for (let i = 2; nodes.some((n) => n.id === id); i++) id = `${base}${i}`;
      const position = pos ?? rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
      setNodes((ns) => [...ns, { id, type: "ork", position, data: { type: t.type, params: {}, info: t } }]);
      setSelected(id);
      markDirty();
    },
    [nodes, rf, setNodes, markDirty],
  );

  const save = useCallback(async () => {
    setBusy("save");
    try {
      const r = await api<WorkflowResp>(`/api/workflows/${wfId}`, { method: "PUT", json: { name, graph: toGraph(nodes, edges), expectedVersion: version } });
      setVersion(r.workflow.version);
      setIssues(r.validation.issues);
      setDirty(false);
      toast(`Saved v${r.workflow.version}`, "ok");
      return true;
    } catch (e) {
      toast((e as Error).message, "err");
      return false;
    } finally {
      setBusy(null);
    }
  }, [wfId, name, nodes, edges, version]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [save]);

  const startRun = async () => {
    if (dirty && !(await save())) return;
    setBusy("run");
    try {
      const r = await api<{ runId: string }>(`/api/workflows/${wfId}/run`, { method: "POST", json: { preauthorizedUsd: Number(preauth) || 0 } });
      setRunId(r.runId);
      router.replace(`?run=${r.runId}`);
      void runs.reload();
      toast("Run queued — the worker picks it up within a second", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };

  const runAction = async (path: string, json: unknown, msg: string) => {
    try {
      const r = await api<{ runId?: string }>(path, { method: "POST", json });
      if (r?.runId) {
        setRunId(r.runId);
        router.replace(`?run=${r.runId}`);
        void runs.reload();
      }
      toast(msg, "ok");
      void run.reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const errors = issues.filter((i) => i.level === "error");
  const sel = nodes.find((n) => n.id === selected);
  const selRun = run.data?.nodes.find((n) => n.nodeId === selected);
  const active = run.data && ["queued", "running", "waiting_approval"].includes(run.data.run.status);
  const pendingApprovals = run.data?.approvals.filter((a) => a.status === "pending") ?? [];

  return (
    <div className="flex h-[calc(100vh-113px)] flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-panel px-3 py-2">
        <input value={name} onChange={(e) => (setName(e.target.value), markDirty())} className="h-7 w-64 rounded border border-transparent bg-transparent px-1.5 text-[13px] font-semibold hover:border-line focus:border-line focus:outline-none" aria-label="Workflow name" />
        <span className="text-[11px] text-faint">v{version}{dirty ? " · unsaved" : ""}</span>
        <div className="mx-1 h-5 w-px bg-line" />
        <Button size="sm" onClick={save} busy={busy === "save"} disabled={!dirty}>
          <Save className="size-3.5" /> Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => (setNodes(layout(nodes, edges)), markDirty(), setTimeout(() => rf.fitView({ padding: 0.15 }), 30))}>
          <LayoutGrid className="size-3.5" /> Auto-layout
        </Button>
        <span className={cn("flex items-center gap-1 text-[11px]", errors.length ? "text-err" : "text-ok")}>
          {errors.length ? <AlertTriangle className="size-3.5" /> : <Check className="size-3.5" />}
          {errors.length ? `${errors.length} issue${errors.length > 1 ? "s" : ""}` : "valid"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px] text-muted" title="Paid steps whose known price fits this budget run without asking. Unknown prices always ask.">
            <Lock className="size-3 text-paid" /> preauthorize $
            <input value={preauth} onChange={(e) => setPreauth(e.target.value)} type="number" min={0} step="0.5" className="h-7 w-16 rounded border border-line bg-bg px-1.5 text-xs" />
          </label>
          <Button size="sm" variant="primary" onClick={startRun} busy={busy === "run"} disabled={errors.length > 0 || nodes.length === 0}>
            <Play className="size-3.5" /> Run
          </Button>
          {runs.data && runs.data.length > 0 && (
            <Select
              className="h-7 w-52 text-xs"
              value={runId ?? ""}
              onChange={(e) => (setRunId(e.target.value), router.replace(`?run=${e.target.value}`))}
              options={runs.data.map((r) => ({ value: r.id, label: `${r.status} · ${ago(r.createdAt)}` }))}
            />
          )}
          {active && (
            <Button size="sm" variant="danger" onClick={() => runAction(`/api/runs/${runId}/cancel`, {}, "Cancelling…")}>
              <Square className="size-3" /> Cancel
            </Button>
          )}
          {run.data && ["failed", "cancelled"].includes(run.data.run.status) && (
            <Button size="sm" onClick={() => runAction(`/api/runs/${runId}/retry`, {}, "Retrying failed nodes (completed ones are kept)")}>
              <RotateCcw className="size-3.5" /> Retry failed
            </Button>
          )}
        </div>
      </div>
      {run.data && (
        <div className="flex items-center gap-3 border-b border-line bg-panel/60 px-3 py-1.5 text-[11px]">
          <StatusBadge status={run.data.run.status} />
          <Progress className="max-w-xs" value={run.data.run.progress} tone={run.data.run.status === "failed" ? "err" : run.data.run.status === "completed" ? "ok" : "accent"} />
          <span className="text-muted">{Object.entries(run.data.run.counts).map(([k, v]) => `${v} ${k}`).join(" · ")}</span>
          <span className="text-muted">spent {fmtUsd(run.data.run.spentUsd)}</span>
          {pendingApprovals.length > 0 && (
            <a href="/queue" className="ml-auto text-accent underline">
              {pendingApprovals.length} waiting for approval →
            </a>
          )}
          {run.data.run.error && <span className="truncate text-err">{run.data.run.error}</span>}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <Palette types={types.data ?? []} onAdd={addNode} />
        <div
          className="relative min-w-0 flex-1"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const t = byType.get(e.dataTransfer.getData("application/orkestr-node"));
            if (t) addNode(t, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={markDirty}
            onNodesDelete={markDirty}
            onEdgesDelete={markDirty}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onSelectionChange={({ nodes: s }) => setSelected(s[0]?.id ?? null)}
            deleteKeyCode={["Delete", "Backspace"]}
            forceColorMode="dark"
            minZoom={0.15}
            fitView
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#2a2e34" />
            <Controls position="bottom-left" />
            <MiniMap pannable zoomable position="bottom-right" nodeColor={(n) => ((n.data as OrkNodeData).run?.status === "failed" ? "#e5675e" : (n.data as OrkNodeData).run?.status === "completed" ? "#5fbf8f" : "#343941")} />
          </ReactFlow>
          {nodes.length === 0 && wf.data && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted">Drag nodes from the palette, or click one to add it.</div>
          )}
        </div>
        <Inspector
          key={selected ?? "none"}
          node={sel}
          nodeRun={selRun}
          runId={runId}
          projectScenes={project?.scenes ?? []}
          onChange={(patch) => {
            setNodes((ns) => ns.map((n) => (n.id === selected ? { ...n, data: { ...n.data, ...patch } } : n)));
            markDirty();
          }}
          onDelete={() => {
            setNodes((ns) => ns.filter((n) => n.id !== selected));
            setEdges((es) => es.filter((e) => e.source !== selected && e.target !== selected));
            setSelected(null);
            markDirty();
          }}
          onRerun={() => runId && runAction(`/api/runs/${runId}/rerun`, { nodeIds: [selected] }, "New run: this node is forced, everything unaffected is reused")}
        />
      </div>

      <BottomPanel tab={bottom} setTab={setBottom} issues={issues} runId={runId} onPick={(id) => setSelected(id)} />
    </div>
  );
}

function Palette({ types, onAdd }: { types: NodeTypeInfo[]; onAdd: (t: NodeTypeInfo) => void }) {
  const [q, setQ] = useState("");
  const [showUnavailable, setShowUnavailable] = useState(true);
  const list = types.filter((t) => (showUnavailable || t.available) && (!q || `${t.label} ${t.type} ${t.description}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
      <div className="space-y-2 border-b border-line p-2">
        <Input placeholder="Search nodes…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1.5 text-[11px] text-muted">
          <input type="checkbox" checked={showUnavailable} onChange={(e) => setShowUnavailable(e.target.checked)} /> show unavailable
        </label>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {FAMILY_ORDER.map((f) => {
          const items = list.filter((t) => t.family === f);
          if (!items.length) return null;
          return (
            <div key={f} className="mb-3">
              <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-faint">{FAMILY_LABEL[f]}</div>
              {items.map((t) => (
                <button
                  key={t.type}
                  draggable={t.available}
                  onDragStart={(e) => e.dataTransfer.setData("application/orkestr-node", t.type)}
                  onClick={() => (t.available ? onAdd(t) : toast(t.unavailableReason ?? "unavailable", "info"))}
                  title={t.available ? t.description : `Unavailable: ${t.unavailableReason}`}
                  className={cn("mb-0.5 flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs", t.available ? "text-fg hover:bg-panel-2" : "cursor-help text-faint")}
                >
                  <span className="min-w-0 flex-1 truncate">{t.label}</span>
                  {t.paid && <Pill tone="paid">paid</Pill>}
                  {!t.available && <AlertTriangle className="size-3 shrink-0 text-warn/70" />}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function Inspector({
  node,
  nodeRun,
  runId,
  projectScenes,
  onChange,
  onDelete,
  onRerun,
}: {
  node?: FNode;
  nodeRun?: NodeRunView;
  runId: string | null;
  projectScenes: { id: string; idx: number; title: string }[];
  onChange: (p: Partial<OrkNodeData>) => void;
  onDelete: () => void;
  onRerun: () => void;
}) {
  const [tab, setTab] = useState<"params" | "output">(nodeRun && nodeRun.status !== "pending" ? "output" : "params");
  if (!node)
    return (
      <aside className="w-80 shrink-0 border-l border-line bg-panel p-4 text-xs text-muted">
        Select a node to edit its parameters, inspect outputs, logs and errors, or rerun it.
        <div className="mt-4 space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-faint">Port types</div>
          {Object.entries(PORT_COLORS).map(([k, c]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: c }} />
              {k}
            </div>
          ))}
        </div>
      </aside>
    );
  const info = node.data.info;
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-panel">
      <div className="border-b border-line p-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{node.data.label || info?.label}</div>
            <div className="text-[11px] text-faint">
              {node.id} · {node.data.type}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onDelete} aria-label="Delete node">
            <Trash2 className="size-3.5" />
          </Button>
        </div>
        {info && <div className="mt-2 text-[11px] leading-relaxed text-muted">{info.description}</div>}
        {info && !info.available && <div className="mt-2 rounded border border-warn/30 bg-warn/10 px-2 py-1.5 text-[11px] text-warn">Unavailable: {info.unavailableReason}</div>}
        {info?.paid && <div className="mt-2 rounded border border-paid/30 bg-paid/10 px-2 py-1.5 text-[11px] text-paid">Paid step: the run pauses for your approval before anything is spent.</div>}
        <div className="mt-2 flex gap-1">
          {(["params", "output"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={cn("rounded px-2 py-1 text-[11px]", tab === t ? "bg-panel-2 text-fg" : "text-muted hover:text-fg")}>
              {t === "params" ? "Parameters" : "Run output"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {tab === "params" ? (
          <>
            <Field label="Label">
              <Input value={node.data.label ?? ""} onChange={(e) => onChange({ label: e.target.value })} />
            </Field>
            {projectScenes.length > 0 && (
              <Field label="Storyboard scene" hint="Outputs are versioned on this scene.">
                <Select value={node.data.sceneId ?? ""} onChange={(e) => onChange({ sceneId: e.target.value || undefined })} options={[{ value: "", label: "— none —" }, ...projectScenes.map((s) => ({ value: s.id, label: `${s.idx + 1}. ${s.title}` }))]} />
              </Field>
            )}
            {info && <ParamsForm schema={info.paramsJsonSchema as never} value={node.data.params} onChange={(params) => onChange({ params })} />}
            <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
              <Field label="Max attempts">
                <Input type="number" min={1} max={10} value={node.data.retry?.maxAttempts ?? ""} placeholder="3" onChange={(e) => onChange({ retry: { ...node.data.retry, maxAttempts: e.target.value ? Number(e.target.value) : undefined } })} />
              </Field>
              <Field label="Backoff ms">
                <Input type="number" min={0} value={node.data.retry?.backoffMs ?? ""} placeholder="2000" onChange={(e) => onChange({ retry: { ...node.data.retry, backoffMs: e.target.value ? Number(e.target.value) : undefined } })} />
              </Field>
            </div>
            {!!node.data.issues?.length && (
              <div className="space-y-1">
                {node.data.issues.map((i) => (
                  <div key={i} className="rounded border border-err/30 bg-err/10 px-2 py-1 text-[11px] text-err">
                    {i}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : !nodeRun ? (
          <div className="text-xs text-muted">{runId ? "This node is not part of the selected run (added after it started)." : "No run yet."}</div>
        ) : (
          <NodeRunPanel nr={nodeRun} onRerun={onRerun} />
        )}
      </div>
    </aside>
  );
}

function NodeRunPanel({ nr, onRerun }: { nr: NodeRunView; onRerun: () => void }) {
  const outs = Object.entries(nr.outputs);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={nr.status} />
        <span className="text-[11px] text-faint">
          attempt {nr.attempt}/{nr.maxAttempts}
        </span>
        {nr.cachedFrom && <Pill tone="info">reused from cache</Pill>}
        {nr.costUsd > 0 && <Pill tone="paid">{fmtUsd(nr.costUsd)}</Pill>}
      </div>
      {nr.status === "running" && <Progress value={nr.progress} indeterminate={nr.progress === 0} tone="info" />}
      {nr.progressMessage && <div className="text-[11px] text-muted">{nr.progressMessage}</div>}
      {nr.estimate && (
        <div className="text-[11px] text-muted">
          Estimate: {fmtUsd(nr.estimate.usd, nr.estimate.known)}
          {nr.estimate.quantity ? ` · ${nr.estimate.quantity} ${nr.estimate.unit}s` : ""} — {nr.estimate.basis}
        </div>
      )}
      {nr.error && (
        <div className="rounded border border-err/30 bg-err/10 px-2 py-1.5 text-[11px] text-err">
          <span className="font-semibold">{nr.error.code}</span> {nr.error.message}
        </div>
      )}
      {outs.map(([port, vals]) => (
        <div key={port}>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">{port}</div>
          <div className="space-y-2">
            {vals.map((v, i) => ("assetId" in v ? <OutputAsset key={v.assetId} id={v.assetId} /> : <pre key={i} className="max-h-48 overflow-auto rounded bg-bg p-2 text-[10px] text-muted" dir="auto">{typeof v.value === "string" ? v.value : JSON.stringify(v.value, null, 2)}</pre>))}
          </div>
        </div>
      ))}
      {["completed", "failed", "cancelled", "skipped"].includes(nr.status) && (
        <Button size="sm" onClick={onRerun} className="w-full">
          <RotateCcw className="size-3.5" /> Rerun this node (+ dependents)
        </Button>
      )}
      <NodeLog nodeRunId={nr.id} />
    </div>
  );
}

function OutputAsset({ id }: { id: string }) {
  const { data } = useApi<{ asset: AssetLite & { size: number } }>(`/api/assets/${id}`);
  if (!data) return <div className="h-10 animate-pulse rounded bg-panel-2" />;
  const a = data.asset;
  return (
    <div className="overflow-hidden rounded border border-line">
      {["image", "video"].includes(a.kind) ? (
        <div className="aspect-video bg-black">
          <AssetPreview asset={a} />
        </div>
      ) : a.kind === "audio" ? (
        <div className="p-2">
          <AssetPreview asset={a} />
        </div>
      ) : null}
      <div className="flex items-center justify-between px-2 py-1 text-[10px] text-muted">
        <span className="truncate">{a.label}</span>
        <a href={`/api/assets/${id}/file?download=1`} className="shrink-0 hover:text-fg">
          download
        </a>
      </div>
    </div>
  );
}

function NodeLog({ nodeRunId }: { nodeRunId: string }) {
  const [lines, setLines] = useState<OrkEvent[]>([]);
  useEvents(
    useCallback(
      (e: OrkEvent) => {
        if (e.node_run_id === nodeRunId) setLines((l) => [...l.slice(-60), e]);
      },
      [nodeRunId],
    ),
  );
  if (!lines.length) return null;
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-faint">Live log</div>
      <div className="max-h-40 overflow-y-auto rounded bg-bg p-2 font-mono text-[10px] leading-relaxed">
        {lines.map((l) => (
          <div key={l.id} className={l.level === "error" ? "text-err" : l.level === "warn" ? "text-warn" : "text-muted"}>
            {new Date(l.ts).toLocaleTimeString()} {l.message}
          </div>
        ))}
      </div>
    </div>
  );
}

function BottomPanel({ tab, setTab, issues, runId, onPick }: { tab: "issues" | "log"; setTab: (t: "issues" | "log") => void; issues: ValidationIssue[]; runId: string | null; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(true);
  const [log, setLog] = useState<OrkEvent[]>([]);
  useEffect(() => setLog([]), [runId]);
  useEvents(
    useCallback(
      (e: OrkEvent) => {
        if (runId && e.run_id === runId) setLog((l) => [...l.slice(-300), e]);
      },
      [runId],
    ),
  );
  return (
    <div className={cn("shrink-0 border-t border-line bg-panel", open ? "h-40" : "h-8")}>
      <div className="flex h-8 items-center gap-1 px-2">
        {(["issues", "log"] as const).map((t) => (
          <button key={t} onClick={() => (setTab(t), setOpen(true))} className={cn("rounded px-2 py-0.5 text-[11px]", tab === t && open ? "bg-panel-2 text-fg" : "text-muted hover:text-fg")}>
            {t === "issues" ? `Validation (${issues.length})` : `Run log (${log.length})`}
          </button>
        ))}
        <button onClick={() => setOpen(!open)} className="ml-auto text-[11px] text-faint hover:text-fg">
          {open ? "hide" : "show"}
        </button>
      </div>
      {open && (
        <div className="h-32 overflow-y-auto px-3 pb-2 font-mono text-[11px]">
          {tab === "issues" ? (
            issues.length ? (
              issues.map((i, k) => (
                <button key={k} onClick={() => i.nodeId && onPick(i.nodeId)} className={cn("block w-full text-left", i.level === "error" ? "text-err" : "text-warn")}>
                  [{i.code}] {i.message}
                </button>
              ))
            ) : (
              <div className="text-ok">Graph is valid.</div>
            )
          ) : log.length ? (
            log.map((l) => (
              <div key={l.id} className={l.level === "error" ? "text-err" : l.level === "warn" ? "text-warn" : "text-muted"}>
                {new Date(l.ts).toLocaleTimeString()} {l.message}
              </div>
            ))
          ) : (
            <div className="text-faint">{runId ? "Waiting for events from this run…" : "Run the workflow to see its log."}</div>
          )}
        </div>
      )}
    </div>
  );
}
