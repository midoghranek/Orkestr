"use client";

import Link from "next/link";
import { Activity, ArrowRight, ArrowUpRight, Cpu, Film, Hand, PlayCircle, Sparkles, Wrench } from "lucide-react";
import { ago, fmtUsd, useApi, type OrkEvent } from "@/lib/api";
import { AssetPreview, Card, CardHeader, Empty, ErrorNote, LoadingRows, PageHeader, Pill, Progress, Stat, StatusBadge, cn, linkCls } from "@/components/ui";
import type { ApprovalLite, AssetFull, RunLite } from "@/components/project-context";
import { NewProjectButton } from "@/components/new-project";

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  updatedAt: number;
  stats: { workflows: number; runs: number; assets: number; lastRunStatus: string | null };
}

interface SystemInfo {
  registry: { generatedAt: number; tools: { id: string; name: string; health: { status: string; message: string }; capabilities: { id: string; ready: boolean; paid: boolean }[] }[] } | null;
  worker: { alive: boolean; lastSeen: number | null };
}

const live = (e: OrkEvent) => e.type.startsWith("run.") || e.type.startsWith("node.completed") || e.type.startsWith("approval");
const ACTIVE = ["queued", "running", "waiting_approval"];
const runTone = (s: string) => (s === "failed" ? "err" : s === "completed" ? "ok" : "accent") as "err" | "ok" | "accent";

export default function Dashboard() {
  const projects = useApi<ProjectRow[]>("/api/projects", { events: (e) => e.type.startsWith("run.") });
  const runs = useApi<(RunLite & { projectId: string })[]>("/api/runs?limit=12", { events: live, refreshMs: 8000 });
  const approvals = useApi<ApprovalLite[]>("/api/approvals?status=pending", { events: live });
  const sys = useApi<SystemInfo>("/api/system", { refreshMs: 15_000 });
  const firstProject = projects.data?.[0];
  const renders = useApi<AssetFull[]>(firstProject ? `/api/assets?projectId=${firstProject.id}&kind=video&limit=6` : null, { events: (e) => e.type === "node.completed" });

  const tools = sys.data?.registry?.tools ?? [];
  const caps = tools.flatMap((t) => t.capabilities);
  const ready = caps.filter((c) => c.ready).length;
  const active = runs.data?.filter((r) => ACTIVE.includes(r.status)) ?? [];
  const failed = runs.data?.filter((r) => r.status === "failed").length ?? 0;
  const waiting = approvals.data?.length ?? 0;
  const healthy = tools.filter((t) => t.health.status === "healthy").length;
  const firstRun = projects.data?.length === 0;

  const summary = sys.data
    ? [
        sys.data.worker.alive ? null : "the worker is offline",
        waiting ? `${waiting} decision${waiting > 1 ? "s" : ""} waiting for you` : null,
        active.length ? `${active.length} run${active.length > 1 ? "s" : ""} in progress` : null,
        failed ? `${failed} failed run${failed > 1 ? "s" : ""}` : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow={
          <>
            <span className="inline-block h-2.5 w-6 rounded-sm border border-ink nb-clapper" aria-hidden />
            Control room
          </>
        }
        title="Dashboard"
        sub={sys.data ? (summary.length ? `Right now: ${summary.join(" · ")}.` : "All quiet — nothing needs you right now.") : "Projects, production status and recent renders."}
        actions={<NewProjectButton size="lg" />}
      />

      <div className="space-y-6 px-4 sm:px-6 lg:px-8">
        {firstRun && <FirstRun />}

        {/* KPI strip */}
        <section aria-label="Studio at a glance" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <Link href="/queue" className="nb-lift rounded-card">
            <Stat label="Needs you" value={approvals.data ? waiting : "—"} tone={waiting ? "accent" : "default"} icon={<Hand />} hint={waiting ? "Approvals in the queue" : "No approvals waiting"} />
          </Link>
          <Link href="/queue" className="nb-lift rounded-card">
            <Stat label="Active runs" value={runs.data ? active.length : "—"} tone={active.length ? "info" : "default"} icon={<Activity />} hint={failed ? `${failed} failed recently` : "Queued, running or paused"} />
          </Link>
          <Link href="/settings" className="nb-lift rounded-card">
            <Stat
              label="Worker"
              value={sys.data ? (sys.data.worker.alive ? "Online" : "Offline") : "—"}
              tone={sys.data ? (sys.data.worker.alive ? "ok" : "err") : "default"}
              icon={<Cpu />}
              hint={sys.data?.worker.alive ? "Executing jobs locally" : sys.data ? "Run npm run dev to start it" : "Checking…"}
            />
          </Link>
          <Link href="/settings" className="nb-lift rounded-card">
            <Stat
              label="Capabilities"
              value={
                caps.length ? (
                  <>
                    {ready}
                    <span className="text-[20px] text-ink/50">/{caps.length}</span>
                  </>
                ) : (
                  "—"
                )
              }
              icon={<Wrench />}
              hint={sys.data?.registry ? `Verified ${ago(sys.data.registry.generatedAt)}` : "No discovery yet"}
            />
          </Link>
        </section>

        {/* Bento */}
        <div className="grid gap-6 lg:grid-cols-12">
          <Card className={cn("lg:col-span-7", waiting > 0 && "shadow-brut-lg")}>
            <CardHeader
              eyebrow="01 · Decisions"
              title="Needs your decision"
              sub="Paid steps and creative checkpoints wait here — nothing is spent without approval."
              actions={
                <Link href="/queue" className={linkCls}>
                  Open queue <ArrowRight className="size-3.5" />
                </Link>
              }
            />
            {approvals.loading && !approvals.data ? (
              <LoadingRows rows={2} />
            ) : approvals.data?.length ? (
              <ul className="divide-y-2 divide-line">
                {approvals.data.slice(0, 5).map((a) => (
                  <li key={a.id}>
                    <Link href="/queue" className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-accent/25">
                      <Pill tone={a.kind === "cost" ? "paid" : "info"}>{a.kind === "cost" ? "spend" : "creative"}</Pill>
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{a.title}</span>
                      {a.kind === "cost" && <span className="font-mono text-[13px] font-semibold text-paid">{fmtUsd(a.amountUsd, a.amountKnown)}</span>}
                      <span className="w-full text-[12px] text-faint sm:w-auto">
                        {a.projectName} · {ago(a.requestedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex items-center gap-3 px-4 py-6 text-[14px] text-muted">
                <span className="flex size-9 items-center justify-center rounded-full border-2 border-ink bg-ok-fill text-ink" aria-hidden>
                  ✓
                </span>
                Nothing waiting. Approvals appear here the moment a run pauses for you.
              </div>
            )}
          </Card>

          <Card className="lg:col-span-5">
            <CardHeader eyebrow="02 · Runs" title="Recent runs" actions={<Link href="/queue" className={linkCls}>All runs <ArrowRight className="size-3.5" /></Link>} />
            {runs.loading && !runs.data ? (
              <LoadingRows rows={3} />
            ) : runs.data?.length ? (
              <ul className="divide-y-2 divide-line">
                {runs.data.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    <Link href={`/projects/${r.projectId}/flows/${r.workflowId}?run=${r.id}`} className="block px-4 py-3 transition-colors hover:bg-panel-2">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{r.workflowName}</span>
                        <StatusBadge status={r.status} />
                      </div>
                      <Progress className="mt-2" value={r.progress} indeterminate={r.status === "running" && r.progress === 0} tone={runTone(r.status)} label={`${r.workflowName} progress`} />
                      <div className="mt-1.5 flex justify-between font-mono text-[11px] text-faint">
                        <span>{ago(r.createdAt)}</span>
                        <span>{Math.round(r.progress * 100)}%</span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4">
                <Empty title="No runs yet" icon={<PlayCircle className="size-6" />}>
                  Open a project workflow and press Run.
                </Empty>
              </div>
            )}
          </Card>

          <Card className="lg:col-span-8">
            <CardHeader eyebrow="03 · Work" title="Projects" actions={<Link href="/projects" className={linkCls}>All projects <ArrowRight className="size-3.5" /></Link>} />
            {projects.error && (
              <div className="p-4">
                <ErrorNote>{projects.error}</ErrorNote>
              </div>
            )}
            {!projects.data && !projects.error && <LoadingRows rows={3} />}
            {projects.data?.length === 0 && (
              <div className="p-4">
                <Empty title="No projects yet" icon={<Film className="size-6" />} action={<NewProjectButton />}>
                  Create a project, give the AI Director a brief, and Orkestr plans and runs the production with the tools verified on this machine.
                </Empty>
              </div>
            )}
            {!!projects.data?.length && (
              <ul className="grid gap-3 p-4 sm:grid-cols-2">
                {projects.data.slice(0, 6).map((p) => (
                  <li key={p.id}>
                    <Link href={`/projects/${p.slug}`} className="nb-lift group flex h-full flex-col rounded-card border-2 border-ink bg-white/60 p-3.5 shadow-brut-xs">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 font-display text-[17px] font-bold leading-tight">{p.name}</span>
                        <ArrowUpRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden />
                      </div>
                      <p className="mt-1 line-clamp-2 text-[13px] text-muted">{p.description || "No description"}</p>
                      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2 pt-3 font-mono text-[11px] text-faint">
                        <span>{p.stats.workflows} flows</span>
                        <span>{p.stats.runs} runs</span>
                        <span>{p.stats.assets} assets</span>
                        {p.stats.lastRunStatus && <StatusBadge status={p.stats.lastRunStatus} className="ml-auto" />}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="lg:col-span-4">
            <CardHeader
              eyebrow="04 · Toolbox"
              title="Studio tools"
              sub={tools.length ? `${healthy} of ${tools.length} tools healthy` : undefined}
              actions={<Link href="/settings" className={linkCls}>Details <ArrowRight className="size-3.5" /></Link>}
            />
            {!sys.data ? (
              <LoadingRows rows={2} />
            ) : tools.length === 0 ? (
              <div className="p-4 text-[13px] text-muted">No discovery yet. Run <code className="font-mono">npm run discover</code>.</div>
            ) : (
              <ul className="flex flex-wrap gap-2 p-4">
                {[...tools]
                  .sort((a, b) => rank(a.health.status) - rank(b.health.status))
                  .map((t) => (
                    <li key={t.id}>
                      <Pill tone={t.health.status === "healthy" ? "ok" : t.health.status === "degraded" ? "warn" : "default"} title={`${t.health.status}: ${t.health.message}`} className={t.health.status === "healthy" || t.health.status === "degraded" ? "" : "text-muted line-through decoration-ink/30"}>
                        <span aria-hidden>{t.health.status === "healthy" ? "●" : t.health.status === "degraded" ? "◐" : "○"}</span>
                        {t.name.split(" ")[0]}
                        <span className="sr-only"> ({t.health.status})</span>
                      </Pill>
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          {!!renders.data?.length && firstProject && (
            <Card className="lg:col-span-12">
              <CardHeader
                eyebrow="05 · Output"
                title="Recent renders"
                sub={firstProject.name}
                actions={<Link href={`/projects/${firstProject.slug}/assets`} className={linkCls}>Asset library <ArrowRight className="size-3.5" /></Link>}
              />
              <ul className="grid grid-cols-2 gap-4 p-4 md:grid-cols-3 xl:grid-cols-6">
                {renders.data.map((a) => (
                  <li key={a.id}>
                    <Link href={`/projects/${firstProject.slug}/preview`} className="group block">
                      <div className="nb-lift aspect-video overflow-hidden rounded-ctl border-2 border-ink bg-ink shadow-brut-xs">
                        <AssetPreview asset={a} controls={false} />
                      </div>
                      <div className="mt-1.5 truncate text-[12px] font-medium text-muted group-hover:text-ink">{a.label}</div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

const rank = (s: string) => (s === "healthy" ? 0 : s === "degraded" ? 1 : 2);

/** First-run hero: explains the product in three steps. Only shown when there are no projects. */
function FirstRun() {
  const steps = [
    { n: "01", t: "Brief", d: "Tell the AI Director what you're making — format, language, audience.", c: "bg-accent" },
    { n: "02", t: "Plan", d: "Get a script, storyboard and a workflow built only from tools verified on this machine.", c: "bg-paid-fill" },
    { n: "03", t: "Run & approve", d: "The worker renders locally. Paid steps and creative checkpoints wait for your OK.", c: "bg-ok-fill" },
  ];
  return (
    <section className="overflow-hidden rounded-sheet border-2 border-ink bg-ink text-cream shadow-brut-lg">
      <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div>
          <div className="nb-label inline-flex items-center gap-2 rounded-full border-2 border-cream/30 px-3 py-1 text-accent">
            <Sparkles className="size-3.5" /> Local-first creative studio
          </div>
          <h2 className="mt-4 font-display text-[40px] font-extrabold leading-[0.92] tracking-[-0.035em] sm:text-[56px]">
            AI decides.
            <br />
            The engine executes.
            <br />
            <span className="bg-accent px-2 text-ink [box-decoration-break:clone]">You stay in control.</span>
          </h2>
          <div className="mt-6">
            <NewProjectButton size="lg" />
          </div>
        </div>
        <ol className="grid gap-3">
          {steps.map((s) => (
            <li key={s.n} className={cn("flex gap-4 rounded-card border-2 border-cream p-4 text-ink", s.c)}>
              <span className="font-mono text-[13px] font-bold">{s.n}</span>
              <div>
                <div className="font-display text-[19px] font-bold leading-tight">{s.t}</div>
                <p className="mt-0.5 text-[13px] leading-snug text-ink/80">{s.d}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
