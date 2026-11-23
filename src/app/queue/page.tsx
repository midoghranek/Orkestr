"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Hand, RefreshCw, Terminal } from "lucide-react";
import type { NodeRunView, RunView } from "@/server/views";
import type { ApprovalLite } from "@/components/project-context";
import { AssetPreview, Button, Card, CardHeader, Empty, ErrorNote, Input, LoadingRows, Notice, PageHeader, Pill, Progress, Spinner, StatusBadge, Tabs, btnCls, cn, linkCls, toast, type AssetLite } from "@/components/ui";
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

  const pending = approvals.data?.length ?? 0;
  return (
    <div className="mx-auto max-w-6xl pb-12">
      <PageHeader
        eyebrow="Production control"
        title="Render Queue"
        sub="Approvals, running jobs and history across all projects."
        actions={
          <Button size="sm" variant="outline" onClick={reloadAll} aria-label="Refresh queue">
            {runs.loading ? <Spinner /> : <RefreshCw className="size-3.5" aria-hidden />}
            Refresh
          </Button>
        }
      />
      <div className="space-y-6 px-4 sm:px-6 lg:px-8">
        <section aria-labelledby="approvals-h" className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="nb-label text-faint">01 · Decisions</span>
            <h2 id="approvals-h" className="font-display text-[20px] font-bold leading-none tracking-[-0.01em] text-ink">
              Pending approvals
            </h2>
            {pending > 0 && <Pill tone="paid">{pending}</Pill>}
            {approvals.loading && <Spinner className="text-faint" />}
          </div>
          <ErrorNote>{approvals.error}</ErrorNote>
          {!approvals.data && !approvals.error && <LoadingRows rows={2} className="p-0" />}
          {approvals.data && approvals.data.length === 0 && (
            <Empty title="Nothing waiting for you" icon={<Hand className="size-6" />}>
              Paid steps and creative reviews that need a decision appear here.
            </Empty>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {approvals.data?.map((a) => (
              <ApprovalCard key={a.id} a={a} onDone={reloadAll} />
            ))}
          </div>
        </section>

        <section aria-labelledby="runs-h">
          <Card>
            <CardHeader eyebrow="02 · Runs" title={<span id="runs-h">Runs</span>} sub="Updates live. Expand a run to see its nodes." />
            <div className="border-b-2 border-line px-2 py-1.5">
              <Tabs
                value={filter}
                onChange={setFilter}
                tabs={[
                  { value: "active", label: `Active (${counts.active})` },
                  { value: "failed", label: `Failed (${counts.failed})` },
                  { value: "completed", label: `Completed (${counts.completed})` },
                  { value: "all", label: `All (${counts.all})` },
                ]}
              />
            </div>
            <div className="space-y-3 p-3 sm:p-4">
              <ErrorNote>{runs.error}</ErrorNote>
              {runs.loading && !runs.data && <LoadingRows rows={3} className="p-0" />}
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
  const isCost = a.kind === "cost";
  return (
    <Card className="overflow-hidden shadow-brut-lg">
      <div className={cn("flex flex-wrap items-center gap-2 border-b-2 border-ink px-4 py-2", isCost ? "bg-paid-fill" : "bg-accent")}>
        <Hand className="size-4" aria-hidden />
        <span className="nb-label text-ink">{isCost ? "Spend approval" : "Creative review"}</span>
        <Pill tone={isCost ? "paid" : "info"} className="ml-auto bg-panel">
          {a.kind}
        </Pill>
      </div>
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <h3 className="min-w-0 flex-1 basis-48 break-words font-display text-[18px] font-bold leading-tight text-ink" dir="auto">
            {a.title}
          </h3>
          <div className="text-right">
            {a.amountKnown ? (
              <div className="font-mono text-[32px] font-bold leading-none tabular-nums text-ink">{fmtUsd(a.amountUsd, true)}</div>
            ) : (
              <div className="font-mono text-[20px] font-bold leading-none text-ink">price unknown</div>
            )}
          </div>
        </div>
        {a.detail && (
          <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted" dir="auto">
            {a.detail}
          </div>
        )}
        {!a.amountKnown && isCost && <Notice tone="warn">The provider price could not be determined. Approving may spend an unknown amount.</Notice>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
          <Link href={`/projects/${a.projectId}`} className={linkCls}>
            {a.projectName ?? "project"}
          </Link>
          <span className="font-mono">requested {ago(a.requestedAt)}</span>
        </div>
        {a.previewAssetIds.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {a.previewAssetIds.slice(0, 3).map((id) => (
              <Thumb key={id} id={id} />
            ))}
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input aria-label="Optional note" placeholder="Optional note" value={note} onChange={(e) => setNote(e.target.value)} className="w-full sm:min-w-40 sm:flex-1" maxLength={1000} />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
            <Button variant="primary" busy={busy === "approved"} disabled={!!busy} onClick={() => decide("approved")}>
              Approve
            </Button>
            <Button variant="danger" busy={busy === "rejected"} disabled={!!busy} onClick={() => decide("rejected")}>
              Reject
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Thumb({ id }: { id: string }) {
  const { data, error } = useApi<{ asset: AssetLite }>(`/api/assets/${id}`);
  return (
    <div className="flex aspect-video items-center justify-center overflow-hidden rounded-ctl border-2 border-ink bg-panel-2">
      {data ? <AssetPreview asset={data.asset} controls={data.asset.kind === "audio"} /> : error ? <span className="text-[12px] text-err">unavailable</span> : <Spinner className="text-faint" />}
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

  const Chev = open ? ChevronDown : ChevronRight;
  return (
    <div className="rounded-card border-2 border-ink bg-panel">
      <div className="space-y-2.5 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={`${open ? "Hide" : "Show"} nodes for ${run.workflowName}`}
            className="-ml-1 flex min-h-10 min-w-0 flex-1 basis-48 items-center gap-1.5 rounded-ctl pr-2 text-left transition-colors hover:bg-panel-2"
          >
            <Chev className="size-5 shrink-0 text-ink" aria-hidden />
            <span className="min-w-0 break-words text-[14px] font-semibold text-ink" dir="auto">
              {run.workflowName}
            </span>
          </button>
          <StatusBadge status={run.status} />
          {run.parentRunId && <Pill title="Re-run of an earlier run">rerun</Pill>}
          <span className="w-full font-mono text-[12px] text-faint sm:ml-auto sm:w-auto">created {ago(run.createdAt)}</span>
        </div>
        <Progress
          value={run.progress}
          indeterminate={run.status === "running" && run.progress === 0}
          tone={run.status === "failed" ? "err" : run.status === "completed" ? "ok" : "accent"}
          label={`${run.workflowName} progress`}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] text-muted">
          <span>{countsText || "no nodes"}</span>
          <span>spent {fmtUsd(run.spentUsd)}</span>
          {run.preauthorizedUsd > 0 && <span>pre-authorized {fmtUsd(run.preauthorizedUsd)}</span>}
          <span>duration {fmtDur(dur)}</span>
        </div>
        <ErrorNote>{run.error}</ErrorNote>
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
          <Link href={`/projects/${run.projectId}/flows/${run.workflowId}?run=${run.id}`} className={btnCls("outline", "sm")}>
            Open
            <ExternalLink className="size-3" aria-hidden />
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
    <div className="space-y-2 border-t-2 border-line px-3 py-3 sm:px-4">
      <ErrorNote>{error}</ErrorNote>
      {loading && !data && <LoadingRows rows={2} className="p-0" />}
      {data?.nodes.map((n) => (
        <div key={n.id} className="rounded-card border-2 border-ink bg-panel px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-semibold text-ink">{n.nodeId}</span>
            <span className="font-mono text-[12px] text-faint">{n.nodeType}</span>
            <StatusBadge status={n.status} />
            {n.cachedFrom && <Pill tone="info" title={`Reused output from ${n.cachedFrom}`}>cached</Pill>}
            <span className="font-mono text-[12px] text-muted">
              attempt {n.attempt}/{n.maxAttempts}
            </span>
            {n.costUsd > 0 && <Pill tone="paid" className="font-mono">{fmtUsd(n.costUsd)}</Pill>}
            <Button size="sm" variant="ghost" className="ml-auto" busy={busy === n.nodeId} onClick={() => rerun(n.nodeId)}>
              Rerun from here
            </Button>
          </div>
          {(n.status === "running" || n.progress > 0) && n.status !== "completed" && (
            <Progress className="mt-1.5" value={n.progress} indeterminate={n.status === "running" && n.progress === 0} tone="info" />
          )}
          {n.progressMessage && n.status === "running" && <div className="mt-1 text-[12px] text-muted">{n.progressMessage}</div>}
          {n.status === "failed" && n.nextAttemptAt > Date.now() && <div className="mt-1 text-[12px] text-warn">retrying {ago(n.nextAttemptAt).replace(" ago", "")} from now</div>}
          {n.error && (
            <div className="mt-2">
              <ErrorNote>
                <span className="font-mono">{n.error.code}</span>: {n.error.message}
              </ErrorNote>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Live log ---------------- */

const LEVEL: Record<OrkEvent["level"], string> = { debug: "text-cream/60", info: "text-info-fill", warn: "text-accent", error: "text-coral" };

function LiveLog() {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<OrkEvent[]>([]);
  const onEvent = useCallback((e: OrkEvent) => setEvents((prev) => [...prev.slice(-99), e]), []);
  useEvents(onEvent);
  const Chev = open ? ChevronDown : ChevronRight;
  return (
    <Card>
      <CardHeader
        eyebrow="03 · Log"
        title="Live log"
        sub={`${events.length} event${events.length === 1 ? "" : "s"} since this page opened (last 100 kept)`}
        actions={
          <>
            {open && events.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setEvents([])}>
                Clear
              </Button>
            )}
            <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="live-log-body" aria-label={open ? "Collapse live log" : "Expand live log"}>
              <Chev className="size-4" aria-hidden />
              {open ? "Collapse" : "Expand"}
            </Button>
          </>
        }
      />
      {open && (
        <div id="live-log-body" className="on-ink max-h-72 overflow-y-auto rounded-b-[10px] bg-ink p-3 font-mono text-[12px] leading-5 text-cream" role="log" aria-label="Live event log">
          {events.length === 0 && (
            <div className="flex items-center gap-2 text-cream/60">
              <Terminal className="size-3.5" aria-hidden /> Waiting for events…
            </div>
          )}
          {[...events].reverse().map((e) => (
            <div key={e.id} className="flex flex-wrap gap-x-2 sm:flex-nowrap">
              <span className="shrink-0 text-cream/60">{new Date(e.ts).toLocaleTimeString()}</span>
              <span className={cn("w-11 shrink-0 font-semibold uppercase", LEVEL[e.level])}>{e.level}</span>
              <span className="shrink-0 text-mint">{e.type}</span>
              <span className={cn("min-w-0 basis-full break-words sm:basis-auto", e.level === "error" ? "text-coral" : "text-cream")}>{e.message}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
