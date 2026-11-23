"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { NodeRunView, RunView } from "@/server/views";
import type { ApprovalLite } from "@/components/project-context";
import { AssetPreview, Button, Card, CardHeader, Empty, ErrorNote, Input, PageHeader, Pill, Progress, Spinner, StatusBadge, Tabs, cn, toast, type AssetLite } from "@/components/ui";
import { ago, api, fmtDur, fmtUsd, useApi, useEvents, type OrkEvent } from "@/lib/api";

const ACTIVE = ["queued", "running", "waiting_approval"];
const liveFilter = (e: OrkEvent) => e.type.startsWith("run.") || e.type.startsWith("node.") || e.type.startsWith("approval");

type Filter = "active" | "failed" | "completed" | "all";

export default function QueuePage() {
  const approvals = useApi<ApprovalLite[]>("/api/approvals?status=pending", { refreshMs: 5000, events: liveFilter });
  const runs = useApi<RunView[]>("/api/runs?limit=100", { refreshMs: 5000, events: liveFilter });
  const [filter, setFilter] = useState<Filter>("active");

  const list = runs.data ?? [];
  const counts = useMemo(
    () => ({
      active: list.filter((r) => ACTIVE.includes(r.status)).length,
      failed: list.filter((r) => r.status === "failed").length,
      completed: list.filter((r) => r.status === "completed").length,
      all: list.length,
    }),
    [list],
  );
  const shown = list.filter((r) => (filter === "all" ? true : filter === "active" ? ACTIVE.includes(r.status) : r.status === filter));
  const reloadAll = useCallback(() => {
    void runs.reload();
    void approvals.reload();
  }, [runs, approvals]);

  return (
    <div className="mx-auto max-w-6xl pb-12">
      <PageHeader
        title="Render Queue"
        sub="Approvals, running jobs and history across all projects."
        actions={
          <Button size="sm" variant="ghost" onClick={reloadAll}>
            {runs.loading ? <Spinner /> : "Refresh"}
          </Button>
        }
      />
      <div className="space-y-5 px-6">
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-fg">
            Pending approvals {approvals.data && approvals.data.length > 0 && <Pill tone="paid">{approvals.data.length}</Pill>}
            {approvals.loading && <Spinner className="text-faint" />}
          </div>
          <ErrorNote>{approvals.error}</ErrorNote>
          {approvals.data && approvals.data.length === 0 && <Empty title="Nothing waiting for you">Paid steps and creative reviews that need a decision appear here.</Empty>}
          <div className="grid gap-3 lg:grid-cols-2">
            {approvals.data?.map((a) => (
              <ApprovalCard key={a.id} a={a} onDone={reloadAll} />
            ))}
          </div>
        </section>

        <section>
          <Card>
            <CardHeader title="Runs" sub="Updates live. Expand a run to see its nodes." />
            <Tabs
              className="px-2"
              value={filter}
              onChange={setFilter}
              tabs={[
                { value: "active", label: `Active (${counts.active})` },
                { value: "failed", label: `Failed (${counts.failed})` },
                { value: "completed", label: `Completed (${counts.completed})` },
                { value: "all", label: `All (${counts.all})` },
              ]}
            />
            <div className="space-y-2 p-3">
              <ErrorNote>{runs.error}</ErrorNote>
              {runs.loading && !runs.data && <div className="flex items-center gap-2 text-xs text-muted"><Spinner /> Loading runs…</div>}
              {runs.data && shown.length === 0 && <Empty title="No runs here">Runs started from a project workflow show up in this list.</Empty>}
              {shown.map((r) => (
                <RunRow key={r.id} run={r} onChanged={reloadAll} />
              ))}
            </div>
          </Card>
        </section>

        <LiveLog />
      </div>
    </div>
  );
}

/* ---------------- Approvals ---------------- */

function ApprovalCard({ a, onDone }: { a: ApprovalLite; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  async function decide(decision: "approved" | "rejected") {
    setBusy(decision);
    try {
      await api(`/api/approvals/${a.id}`, { method: "POST", json: { decision, note: note.trim() || undefined } });
      toast(decision === "approved" ? "Approved" : "Rejected", "ok");
      onDone();
    } catch (e) {
      toast((e as Error).message, "err");
    }
    setBusy(null);
  }
  return (
    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={a.kind === "cost" ? "paid" : "info"}>{a.kind}</Pill>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{a.title}</span>
        <span className={cn("text-[13px] font-semibold", a.amountKnown ? "text-paid" : "text-warn")}>{a.amountKnown ? fmtUsd(a.amountUsd, true) : "price unknown"}</span>
      </div>
      {a.detail && <div className="mt-1.5 whitespace-pre-wrap text-xs text-muted">{a.detail}</div>}
      {!a.amountKnown && a.kind === "cost" && <div className="mt-1.5 text-[11px] text-warn">The provider price could not be determined. Approving may spend an unknown amount.</div>}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[11px] text-faint">
        <Link href={`/projects/${a.projectId}`} className="text-accent hover:underline">
          {a.projectName ?? "project"}
        </Link>
        <span>requested {ago(a.requestedAt)}</span>
      </div>
      {a.previewAssetIds.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {a.previewAssetIds.slice(0, 3).map((id) => (
            <Thumb key={id} id={id} />
          ))}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Input placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} className="min-w-40 flex-1" maxLength={1000} />
        <Button size="sm" variant="primary" busy={busy === "approved"} disabled={!!busy} onClick={() => decide("approved")}>
          Approve
        </Button>
        <Button size="sm" variant="danger" busy={busy === "rejected"} disabled={!!busy} onClick={() => decide("rejected")}>
          Reject
        </Button>
      </div>
    </Card>
  );
}

function Thumb({ id }: { id: string }) {
  const { data, error } = useApi<{ asset: AssetLite }>(`/api/assets/${id}`);
  return (
    <div className="flex aspect-video items-center justify-center overflow-hidden rounded border border-line bg-bg">
      {data ? <AssetPreview asset={data.asset} controls={data.asset.kind === "audio"} /> : error ? <span className="text-[11px] text-err">unavailable</span> : <Spinner className="text-faint" />}
    </div>
  );
}

/* ---------------- Runs ---------------- */

function RunRow({ run, onChanged }: { run: RunView; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const active = ACTIVE.includes(run.status);
  const retryable = run.status === "failed" || run.status === "cancelled";
  const end = run.finishedAt ?? Date.now();
  const dur = run.startedAt ? end - run.startedAt : null;
  const countsText = Object.entries(run.counts)
    .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`)
    .join(" · ");

  async function act(kind: "cancel" | "retry") {
    setBusy(kind);
    try {
      await api(`/api/runs/${run.id}/${kind}`, { method: "POST", json: {} });
      toast(kind === "cancel" ? "Cancelling run" : "Retrying failed nodes", "ok");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    }
    setBusy(null);
  }

  return (
    <div className="rounded-md border border-line bg-bg">
      <div className="space-y-2 px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setOpen((o) => !o)} className="text-faint hover:text-fg" aria-expanded={open} aria-label="Toggle nodes">
            {open ? "▾" : "▸"}
          </button>
          <span className="text-[13px] font-medium text-fg">{run.workflowName}</span>
          <StatusBadge status={run.status} />
          {run.parentRunId && <Pill title="Re-run of an earlier run">rerun</Pill>}
          <span className="ml-auto text-[11px] text-faint">created {ago(run.createdAt)}</span>
        </div>
        <Progress value={run.progress} indeterminate={run.status === "running" && run.progress === 0} tone={run.status === "failed" ? "err" : run.status === "completed" ? "ok" : "accent"} />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
          <span>{countsText || "no nodes"}</span>
          <span>spent {fmtUsd(run.spentUsd)}</span>
          {run.preauthorizedUsd > 0 && <span>pre-authorized {fmtUsd(run.preauthorizedUsd)}</span>}
          <span>duration {fmtDur(dur)}</span>
        </div>
        {run.error && <div className="rounded border border-err/30 bg-err/10 px-2 py-1 text-xs text-err">{run.error}</div>}
        <div className="flex flex-wrap items-center gap-2">
          {active && (
            <Button size="sm" variant="danger" busy={busy === "cancel"} onClick={() => act("cancel")}>
              Cancel
            </Button>
          )}
          {retryable && (
            <Button size="sm" busy={busy === "retry"} onClick={() => act("retry")}>
              Retry failed
            </Button>
          )}
          <Link href={`/projects/${run.projectId}/flows/${run.workflowId}?run=${run.id}`} className="inline-flex h-7 items-center rounded-md border border-line-strong px-2.5 text-xs text-fg hover:bg-panel-2">
            Open
          </Link>
        </div>
      </div>
      {open && <RunNodes run={run} onChanged={onChanged} />}
    </div>
  );
}

interface RunDetail {
  run: RunView;
  nodes: NodeRunView[];
}

function RunNodes({ run, onChanged }: { run: RunView; onChanged: () => void }) {
  const filter = useCallback((e: OrkEvent) => e.run_id === run.id && liveFilter(e), [run.id]);
  const { data, error, loading, reload } = useApi<RunDetail>(`/api/runs/${run.id}`, { refreshMs: ACTIVE.includes(run.status) ? 5000 : undefined, events: filter });
  const [busy, setBusy] = useState<string | null>(null);

  async function rerun(nodeId: string) {
    setBusy(nodeId);
    try {
      const r = await api<{ runId: string }>(`/api/runs/${run.id}/rerun`, { method: "POST", json: { nodeIds: [nodeId] } });
      toast(`Started new run ${r.runId}`, "ok");
      onChanged();
      void reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
    setBusy(null);
  }

  return (
    <div className="space-y-1.5 border-t border-line px-3 py-2.5">
      <ErrorNote>{error}</ErrorNote>
      {loading && !data && <div className="flex items-center gap-2 text-xs text-muted"><Spinner /> Loading nodes…</div>}
      {data?.nodes.map((n) => (
        <div key={n.id} className="rounded border border-line bg-panel px-2.5 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-fg">{n.nodeId}</span>
            <span className="text-[11px] text-faint">{n.nodeType}</span>
            <StatusBadge status={n.status} />
            {n.cachedFrom && <Pill tone="info" title={`Reused output from ${n.cachedFrom}`}>cached</Pill>}
            <span className="text-[11px] text-muted">
              attempt {n.attempt}/{n.maxAttempts}
            </span>
            {n.costUsd > 0 && <Pill tone="paid">{fmtUsd(n.costUsd)}</Pill>}
            <Button size="sm" variant="ghost" className="ml-auto" busy={busy === n.nodeId} onClick={() => rerun(n.nodeId)}>
              Rerun from here
            </Button>
          </div>
          {(n.status === "running" || n.progress > 0) && n.status !== "completed" && (
            <Progress className="mt-1.5" value={n.progress} indeterminate={n.status === "running" && n.progress === 0} tone="info" />
          )}
          {n.progressMessage && n.status === "running" && <div className="mt-1 text-[11px] text-muted">{n.progressMessage}</div>}
          {n.status === "failed" && n.nextAttemptAt > Date.now() && <div className="mt-1 text-[11px] text-warn">retrying {ago(n.nextAttemptAt).replace(" ago", "")} from now</div>}
          {n.error && (
            <div className="mt-1 text-xs text-err">
              <span className="font-mono">{n.error.code}</span>: {n.error.message}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Live log ---------------- */

const LEVEL: Record<OrkEvent["level"], string> = { debug: "text-faint", info: "text-info", warn: "text-warn", error: "text-err" };

function LiveLog() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<OrkEvent[]>([]);
  const onEvent = useCallback((e: OrkEvent) => setEvents((prev) => [...prev.slice(-99), e]), []);
  useEvents(onEvent);
  return (
    <Card>
      <CardHeader
        title="Live log"
        sub={`${events.length} event${events.length === 1 ? "" : "s"} since this page opened (last 100 kept)`}
        actions={
          <>
            {open && events.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setEvents([])}>
                Clear
              </Button>
            )}
            <Button size="sm" onClick={() => setOpen((o) => !o)}>
              {open ? "Collapse" : "Expand"}
            </Button>
          </>
        }
      />
      {open && (
        <div className="max-h-72 overflow-y-auto p-3 font-mono text-[11px] leading-5">
          {events.length === 0 && <div className="text-faint">Waiting for events…</div>}
          {[...events].reverse().map((e) => (
            <div key={e.id} className="flex gap-2">
              <span className="shrink-0 text-faint">{new Date(e.ts).toLocaleTimeString()}</span>
              <span className={cn("w-10 shrink-0 uppercase", LEVEL[e.level])}>{e.level}</span>
              <span className="shrink-0 text-muted">{e.type}</span>
              <span className={cn("min-w-0 break-words", e.level === "error" ? "text-err" : "text-fg")}>{e.message}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
