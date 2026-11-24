"use client";

import { useState } from "react";
import { Check, CircleDashed, Download, Hand, Loader, RotateCcw, Settings, X } from "lucide-react";
import Link from "next/link";
import type { WorkspaceView } from "@/server/producer";
import { api, assetUrl, fmtUsd } from "@/lib/api";
import { Button, Notice, Progress, cn, toast } from "@/components/ui";

/** Real execution state, grouped into stages people understand. No invented percentages or ETAs. */
export function StageList({ view }: { view: WorkspaceView }) {
  return (
    <ol className="space-y-1.5" aria-label="Production progress">
      {view.stages.map((s) => (
        <li key={s.id} className="flex items-center gap-2.5 text-[14px]">
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full border-2",
              s.state === "done" ? "border-ink bg-ok-fill" : s.state === "active" ? "border-ink bg-info-fill" : s.state === "waiting" ? "border-ink bg-accent" : s.state === "failed" ? "border-ink bg-err-fill" : "border-ink/25",
            )}
            aria-hidden
          >
            {s.state === "done" ? <Check className="size-3.5" /> : s.state === "active" ? <Loader className="size-3.5 animate-spin" /> : s.state === "waiting" ? <Hand className="size-3.5" /> : s.state === "failed" ? <X className="size-3.5" /> : <CircleDashed className="size-3.5 text-faint" />}
          </span>
          <span className={cn("flex-1", s.state === "todo" ? "text-muted" : "font-semibold text-ink")}>{s.label}</span>
          <span className="font-mono text-[11px] text-faint">
            {s.done}/{s.total}
            <span className="sr-only"> steps, {s.state}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A creative or cost decision, in plain language, with exactly what is being approved. */
export function ApprovalCard({ a, onDone, productionId }: { a: WorkspaceView["approvals"][number]; onDone: () => void; productionId?: string }) {
  const [busy, setBusy] = useState<"approved" | "rejected" | null>(null);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [askMsg, setAskMsg] = useState<string | null>(null);
  // "Ask for changes" sends the note to Refine (the change re-renders only what it affects) instead of failing the
  // production. If the note can't be turned into a change, the decision stays open and the reason is shown.
  const askForChanges = async () => {
    if (!productionId || !note.trim()) return;
    setBusy("rejected");
    setAskMsg(null);
    try {
      const r = await api<{ summary: string; rerendering: boolean }>(`/api/productions/${productionId}/refine`, { method: "POST", json: { instruction: note } });
      toast(r.rerendering ? `${r.summary} Re-rendering.` : `${r.summary} Review the direction, then Make it.`, "ok");
      onDone();
    } catch (e) {
      setAskMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const decide = async (decision: "approved" | "rejected") => {
    setBusy(decision);
    try {
      await api(`/api/approvals/${a.id}`, { method: "POST", json: { decision, note: note || undefined } });
      onDone();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  };
  const media = a.previewAssetIds.slice(0, 2);
  const isCost = a.kind === "cost";
  return (
    <div className="rounded-card border-2 border-ink bg-accent/20 p-4 shadow-brut-sm">
      <div className="nb-label text-ink">{isCost ? "Spending decision" : "Your OK is needed"}</div>
      <h3 className="mt-1 font-display text-[18px] font-bold leading-tight text-ink">{a.title}</h3>
      <p className="mt-1 text-[14px] leading-relaxed text-muted">{a.detail}</p>
      {isCost && (
        <p className="mt-2 text-[14px] font-semibold">
          Price: {a.amountKnown ? fmtUsd(a.amountUsd) : "unknown until the provider reports it"} <span className="font-normal text-muted">· nothing is charged unless you approve.</span>
        </p>
      )}
      {media.length > 0 && (
        <div className={cn("mt-3 grid gap-2", media.length > 1 && "sm:grid-cols-2")}>
          {media.map((id) => (
            <PreviewMedia key={id} id={id} />
          ))}
        </div>
      )}
      {asking && (
        <label className="mt-3 block">
          <span className="nb-label mb-1 block text-muted">What should change?</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} dir="auto" className="w-full rounded-ctl border-2 border-ink bg-white p-2 text-[14px] outline-none" />
        </label>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => decide("approved")} busy={busy === "approved"}>
          <Check className="size-4" /> {isCost ? "Approve spending" : "Approve"}
        </Button>
        {isCost ? (
          <Button variant="outline" onClick={() => decide("rejected")} busy={busy === "rejected"}>
            Don&apos;t spend
          </Button>
        ) : asking && productionId ? (
          <Button variant="default" onClick={askForChanges} busy={busy === "rejected"} disabled={!note.trim()}>
            Send changes
          </Button>
        ) : (
          <Button variant="outline" onClick={() => setAsking(true)}>
            Ask for changes
          </Button>
        )}
      </div>
      {askMsg && <p className="mt-2 text-[13px] text-warn" role="alert">{askMsg}</p>}
      {asking && !isCost && <p className="mt-2 text-[12px] text-muted">E.g. “make it 20 seconds”, “bigger text”, “remove scene 3”. Only the affected parts are re-made.</p>}
    </div>
  );
}

function PreviewMedia({ id }: { id: string }) {
  const [kind, setKind] = useState<"video" | "image" | "other">("video");
  if (kind === "other") return null;
  return kind === "video" ? (
    <video src={assetUrl(id)} controls playsInline preload="metadata" className="aspect-video w-full rounded-ctl border-2 border-ink bg-ink object-contain" onError={() => setKind("image")} />
  ) : (
    <img src={assetUrl(id)} alt="" className="w-full rounded-ctl border-2 border-ink bg-white object-contain" onError={() => setKind("other")} />
  );
}

/** While producing: real stages, partial results, decisions inline. */
export function ProducingPanel({ view, onChanged }: { view: WorkspaceView; onChanged: () => void }) {
  const ready = view.deliverables.filter((d) => d.assetId);
  const indeterminate = !view.progress || view.progress.done === 0;
  return (
    <div className="space-y-5">
      {view.approvals.map((a) => (
        <ApprovalCard key={a.id} a={a} onDone={onChanged} productionId={view.production?.id} />
      ))}
      <section className="rounded-card border-2 border-ink bg-panel p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[20px] font-bold text-ink">{view.approvals.length ? "Paused for your decision" : "Producing your video"}</h2>
          {view.progress && (
            <span className="font-mono text-[12px] text-muted">
              {view.progress.done} of {view.progress.total} steps
            </span>
          )}
        </div>
        <Progress className="mt-3" value={view.progress ? view.progress.done / view.progress.total : undefined} indeterminate={indeterminate} label="Production progress" />
        <p className="mt-2 text-[13px] text-muted">Runs on this computer in the background — you can leave this page; work is saved and resumes after a restart.</p>
        <div className="mt-4">
          <StageList view={view} />
        </div>
      </section>
      {ready.length > 0 && (
        <section className="rounded-card border-2 border-ink/15 bg-panel p-4">
          <h3 className="nb-label text-faint">Ready to watch</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {ready.map((d) => (
              <figure key={d.name}>
                {d.kind === "video" ? <video src={assetUrl(d.assetId!)} controls playsInline preload="metadata" className="w-full rounded-ctl border-2 border-ink bg-ink" /> : <img src={assetUrl(d.assetId!)} alt={d.name} className="w-full rounded-ctl border-2 border-ink" />}
                <figcaption className="mt-1 text-[12px] text-muted">
                  {d.name} · {d.aspect}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export function RecoveryPanel({ view, onChanged }: { view: WorkspaceView; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const r = view.recovery!;
  const go = async () => {
    setBusy(true);
    try {
      const res = await api<{ action: string }>(`/api/productions/${view.production!.id}/recover`, { method: "POST" });
      toast(`OK — ${res.action}.`, "ok");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Notice tone="warn">
      <div className="font-semibold">{r.message}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {r.action === "settings" ? (
          <Link href="/settings" className="inline-flex h-10 items-center gap-1.5 rounded-ctl border-2 border-ink bg-panel px-3.5 text-[13px] font-semibold shadow-brut-xs">
            <Settings className="size-4" /> Open setup
          </Link>
        ) : null}
        {r.action && (
          <Button variant="primary" onClick={go} busy={busy}>
            <RotateCcw className="size-4" /> {r.action === "replan" ? "Plan again" : "Try again"}
          </Button>
        )}
      </div>
      {r.detail && (
        <details className="mt-3 text-[12px]">
          <summary className="cursor-pointer text-muted">Technical details</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-muted">{r.detail}</pre>
        </details>
      )}
    </Notice>
  );
}

export function DownloadLink({ projectId, name }: { projectId: string; name: string }) {
  return (
    <a href={`/api/exports/file?projectId=${encodeURIComponent(projectId)}&name=${encodeURIComponent(name)}`} className="inline-flex h-9 items-center gap-1.5 rounded-ctl border-2 border-ink bg-panel px-3 text-[13px] font-semibold shadow-brut-xs hover:bg-white" download>
      <Download className="size-4" aria-hidden /> {name.split(".").pop()?.toUpperCase()}
    </a>
  );
}
