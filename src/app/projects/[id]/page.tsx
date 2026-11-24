"use client";

import Link from "next/link";
import { useCallback, useEffect } from "react";
import { useParams } from "next/navigation";
import { ArrowRight, Loader, Sparkles } from "lucide-react";
import type { WorkspaceView } from "@/server/producer";
import { fmtUsd, useApi, type OrkEvent } from "@/lib/api";
import { useProject } from "@/components/project-context";
import { ErrorNote, LoadingRows, Progress, Skeleton, cn, linkCls } from "@/components/ui";
import { DirectionReview } from "@/components/workspace/direction";
import { ProducingPanel, RecoveryPanel } from "@/components/workspace/production";
import { ResultView } from "@/components/workspace/result";
import { RefinePanel } from "@/components/workspace/refine";
import { useMode } from "@/lib/mode";

/**
 * The project workspace: one place for the whole journey — direction, production, decisions, result,
 * refinement and export. The technical tabs (flows, storyboard, queue) stay available in Studio Pro.
 */
export default function Workspace() {
  const { id } = useParams<{ id: string }>();
  const { data: ov } = useProject();
  const pid = ov?.project.id;
  const relevant = useCallback((e: OrkEvent) => !!pid && e.project_id === pid && !e.type.startsWith("node.log") && !e.type.startsWith("node.progress"), [pid]);
  const ws = useApi<WorkspaceView>(`/api/projects/${id}/workspace`, { events: relevant, refreshMs: 6000 });
  const v = ws.data;
  const reload = useCallback(() => void ws.reload(), [ws]);
  const [mode] = useMode();
  const status = v?.production?.status;
  // When the journey moves to its next step, bring the new step into view (the action was usually at the bottom).
  useEffect(() => {
    if (status) document.getElementById("main")?.scrollTo({ top: 0, behavior: "smooth" });
  }, [status]);

  if (ws.error && !v) return <div className="p-6"><ErrorNote>{ws.error}</ErrorNote></div>;
  if (!v)
    return (
      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-8">
        <Skeleton className="h-96" />
        <LoadingRows rows={4} />
      </div>
    );

  if (!v.production) return <NoProduction slug={id} legacy={!!ov?.runs.length} pro={mode === "pro"} />;
  const st = v.production.status;
  return (
    <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-8">
      <div className="min-w-0 space-y-5">
        <StatusLine view={v} />
        {v.recovery && <RecoveryPanel view={v} onChanged={reload} />}
        {(st === "researching" || st === "planning") && <Thinking view={v} />}
        {st === "direction" && v.plan && <DirectionReview view={v} onChanged={reload} />}
        {st === "producing" && <ProducingPanel view={v} onChanged={reload} />}
        {(st === "done" || (st === "failed" && v.deliverables.some((d) => d.assetId))) && <ResultView view={v} projectId={pid ?? id} onChanged={reload} />}
        {st === "failed" && !v.plan && !v.recovery && <ErrorNote>{v.production.error ?? "Something went wrong."}</ErrorNote>}
      </div>
      <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
        {v.plan && st !== "researching" && st !== "planning" && <RefinePanel view={v} onChanged={reload} />}
        <CostCard view={v} />
        <div className="rounded-card border-2 border-ink/15 bg-panel px-4 py-3 text-[13px] text-muted">
          Want the details? Studio Pro shows the{" "}
          <Link href={`/projects/${id}/flows`} className={linkCls}>
            production graph
          </Link>
          ,{" "}
          <Link href={`/projects/${id}/storyboard`} className={linkCls}>
            storyboard
          </Link>{" "}
          and{" "}
          <Link href={`/projects/${id}/assets`} className={linkCls}>
            assets
          </Link>
          .
        </div>
      </aside>
    </div>
  );
}

function StatusLine({ view }: { view: WorkspaceView }) {
  const n = view.nextAction;
  const tone = n.kind === "approve" || n.kind === "review-direction" ? "bg-accent" : n.kind === "recover" ? "bg-err-fill" : n.kind === "export" ? "bg-ok-fill" : "bg-info-fill";
  return (
    <div className="flex flex-wrap items-center gap-3" role="status" aria-live="polite">
      <span className={cn("inline-flex items-center gap-2 rounded-full border-2 border-ink px-3 py-1 text-[13px] font-bold text-ink", tone)}>
        {n.kind === "wait" && <Loader className="size-3.5 animate-spin" aria-hidden />}
        {n.label}
      </span>
      {view.production?.recipe && <span className="text-[13px] text-muted">{view.production.recipe.label}</span>}
    </div>
  );
}

function Thinking({ view }: { view: WorkspaceView }) {
  const st = view.production!.status;
  const ai = view.production!.intent.planner === "ai";
  const steps = [
    { label: "Reading your website", state: st === "researching" ? "active" : view.website ? "done" : "skip" },
    { label: ai ? "The AI Director is writing the creative direction" : "Drafting the creative direction", state: st === "planning" ? "active" : "todo" },
  ].filter((s) => s.state !== "skip");
  return (
    <section className="rounded-card border-2 border-ink bg-panel p-6">
      <h2 className="font-display text-[22px] font-bold text-ink">Working on your direction</h2>
      <p className="mt-1 text-[14px] text-muted" dir="auto">
        “{view.production!.intent.prompt}”
      </p>
      <Progress className="mt-4" indeterminate label="Preparing the creative direction" />
      <ol className="mt-4 space-y-1.5 text-[14px]">
        {steps.map((s) => (
          <li key={s.label} className={cn("flex items-center gap-2", s.state === "todo" ? "text-muted" : "font-semibold text-ink")}>
            {s.state === "active" ? <Loader className="size-4 animate-spin" aria-hidden /> : <span className="inline-block size-4 text-center">{s.state === "done" ? "✓" : "·"}</span>}
            {s.label}
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[13px] text-muted">{ai ? "This usually takes one to three minutes. You can leave this page; it keeps going." : "This takes a few seconds."} You&apos;ll review everything before anything is produced.</p>
    </section>
  );
}

function CostCard({ view }: { view: WorkspaceView }) {
  const c = view.costs;
  return (
    <section className="rounded-card border-2 border-ink/15 bg-panel px-4 py-3" aria-labelledby="cost-h">
      <h2 id="cost-h" className="nb-label text-faint">
        Spending
      </h2>
      <dl className="mt-2 grid grid-cols-2 gap-y-1 text-[13px]">
        <dt className="text-muted">Spent (known)</dt>
        <dd className="text-end font-mono font-semibold">{fmtUsd(c.spentUsd)}</dd>
        {c.budgetUsd > 0 && (
          <>
            <dt className="text-muted">Limit you set</dt>
            <dd className="text-end font-mono">{fmtUsd(c.budgetUsd)}</dd>
            <dt className="text-muted">Remaining</dt>
            <dd className="text-end font-mono">{fmtUsd(c.remainingUsd)}</dd>
          </>
        )}
        {c.unknownCount > 0 && (
          <>
            <dt className="text-muted">Unknown-price calls</dt>
            <dd className="text-end font-mono">{c.unknownCount}</dd>
          </>
        )}
      </dl>
      <p className="mt-2 text-[12px] leading-snug text-faint">
        {c.paidSteps.length ? `${c.paidSteps.length} paid step${c.paidSteps.length > 1 ? "s" : ""} in this production — each asks before spending unless its known price fits your limit.` : "Rendering, captures and captions run locally and cost nothing."}
      </p>
    </section>
  );
}

function NoProduction({ slug, legacy, pro }: { slug: string; legacy: boolean; pro: boolean }) {
  return (
    <div className="mx-auto max-w-2xl p-6 text-center">
      <Sparkles className="mx-auto size-8 text-ink" aria-hidden />
      <h2 className="mt-3 font-display text-[22px] font-bold">{legacy ? "This project was made in Studio Pro" : "Nothing created here yet"}</h2>
      <p className="mt-2 text-[14px] text-muted">{legacy ? "Its workflows, runs and renders are in the Studio Pro tabs. Start a new creation from Create to use the guided workspace." : "Describe what you want on the Create page."}</p>
      <div className="mt-4 flex justify-center gap-3">
        <Link href="/" className={linkCls}>
          Create something <ArrowRight className="size-3.5" />
        </Link>
        {legacy && (
          <Link href={`/projects/${slug}/overview`} className={linkCls}>
            {pro ? "Open the overview" : "Open in Studio Pro"} <ArrowRight className="size-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
