"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ago, fmtUsd, useApi, type OrkEvent } from "@/lib/api";
import { AssetPreview, Card, CardHeader, Empty, PageHeader, Pill, Progress, StatusBadge } from "@/components/ui";
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

export default function Dashboard() {
  const projects = useApi<ProjectRow[]>("/api/projects", { events: (e) => e.type.startsWith("run.") });
  const runs = useApi<(RunLite & { projectId: string })[]>("/api/runs?limit=12", { events: live, refreshMs: 8000 });
  const approvals = useApi<ApprovalLite[]>("/api/approvals?status=pending", { events: live });
  const sys = useApi<SystemInfo>("/api/system", { refreshMs: 15_000 });
  const firstProject = projects.data?.[0];
  const renders = useApi<AssetFull[]>(firstProject ? `/api/assets?projectId=${firstProject.id}&kind=video&limit=6` : null, { events: (e) => e.type === "node.completed" });

  const tools = sys.data?.registry?.tools ?? [];
  const ready = tools.flatMap((t) => t.capabilities).filter((c) => c.ready).length;
  const total = tools.flatMap((t) => t.capabilities).length;
  const active = runs.data?.filter((r) => ["queued", "running", "waiting_approval"].includes(r.status)) ?? [];

  return (
    <div className="pb-10">
      <PageHeader title="Dashboard" sub="Projects, production status and recent renders." actions={<NewProjectButton />} />
      <div className="grid gap-4 px-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Studio status" sub={sys.data?.registry ? `tools checked ${ago(sys.data.registry.generatedAt)}` : "no discovery yet"} actions={<Link href="/settings" className="text-xs text-muted hover:text-fg">Settings</Link>} />
          <div className="grid grid-cols-3 gap-3 p-4">
            <Stat label="Worker" value={sys.data ? (sys.data.worker.alive ? "running" : "offline") : "…"} tone={sys.data?.worker.alive ? "ok" : "err"} />
            <Stat label="Capabilities ready" value={total ? `${ready}/${total}` : "—"} />
            <Stat label="Active runs" value={String(active.length)} />
          </div>
          <div className="flex flex-wrap gap-1.5 px-4 pb-4">
            {tools.map((t) => (
              <Pill key={t.id} tone={t.health.status === "healthy" ? "ok" : t.health.status === "degraded" ? "warn" : "default"} title={t.health.message}>
                {t.name.split(" ")[0]}
              </Pill>
            ))}
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Needs your decision" sub="Paid steps and creative checkpoints wait here — nothing is spent without approval." actions={<Link href="/queue" className="text-xs text-muted hover:text-fg">Render queue →</Link>} />
          <div className="divide-y divide-line">
            {approvals.data?.length ? (
              approvals.data.slice(0, 5).map((a) => (
                <Link key={a.id} href="/queue" className="flex items-center gap-3 px-4 py-2.5 hover:bg-panel-2/50">
                  <Pill tone={a.kind === "cost" ? "paid" : "info"}>{a.kind === "cost" ? "spend" : "creative"}</Pill>
                  <span className="min-w-0 flex-1 truncate text-[13px]">{a.title}</span>
                  <span className="text-xs text-muted">{a.projectName}</span>
                  {a.kind === "cost" && <span className="text-xs text-paid">{fmtUsd(a.amountUsd, a.amountKnown)}</span>}
                  <span className="w-16 text-right text-xs text-faint">{ago(a.requestedAt)}</span>
                </Link>
              ))
            ) : (
              <div className="px-4 py-6 text-center text-xs text-muted">{approvals.loading ? "…" : "Nothing waiting."}</div>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 px-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Projects" actions={<Link href="/projects" className="text-xs text-muted hover:text-fg">All projects</Link>} />
          {projects.data?.length === 0 && (
            <div className="p-4">
              <Empty title="No projects yet" action={<NewProjectButton />}>
                Create a project, give the AI Director a brief, and Orkestr plans and runs the production with the tools verified on this machine.
              </Empty>
            </div>
          )}
          <div className="divide-y divide-line">
            {projects.data?.slice(0, 8).map((p) => (
              <Link key={p.id} href={`/projects/${p.slug}`} className="flex items-center gap-4 px-4 py-3 hover:bg-panel-2/50">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{p.name}</div>
                  <div className="truncate text-xs text-muted">{p.description || "—"}</div>
                </div>
                <div className="hidden text-xs text-faint sm:block">
                  {p.stats.workflows} flows · {p.stats.runs} runs · {p.stats.assets} assets
                </div>
                {p.stats.lastRunStatus && <StatusBadge status={p.stats.lastRunStatus} />}
                <ArrowRight className="size-3.5 text-faint" />
              </Link>
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recent runs" />
          <div className="divide-y divide-line">
            {runs.data?.length ? (
              runs.data.slice(0, 8).map((r) => (
                <Link key={r.id} href={`/projects/${r.projectId}/flows/${r.workflowId}?run=${r.id}`} className="block px-4 py-2.5 hover:bg-panel-2/50">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px]">{r.workflowName}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <Progress className="mt-1.5" value={r.progress} indeterminate={r.status === "running" && r.progress === 0} tone={r.status === "failed" ? "err" : r.status === "completed" ? "ok" : "accent"} />
                  <div className="mt-1 text-[11px] text-faint">{ago(r.createdAt)}</div>
                </Link>
              ))
            ) : (
              <div className="px-4 py-6 text-center text-xs text-muted">{runs.loading ? "…" : "No runs yet."}</div>
            )}
          </div>
        </Card>
      </div>

      {!!renders.data?.length && firstProject && (
        <Card className="mx-6 mt-4">
          <CardHeader title="Recent renders" sub={firstProject.name} actions={<Link href={`/projects/${firstProject.slug}/assets`} className="text-xs text-muted hover:text-fg">Asset library</Link>} />
          <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 xl:grid-cols-6">
            {renders.data.map((a) => (
              <Link key={a.id} href={`/projects/${firstProject.slug}/preview`} className="group">
                <div className="aspect-video overflow-hidden rounded-md border border-line bg-black">
                  <AssetPreview asset={a} controls={false} />
                </div>
                <div className="mt-1 truncate text-[11px] text-muted group-hover:text-fg">{a.label}</div>
              </Link>
            ))}
          </div>
        </Card>
      )}
      {!projects.data && !projects.error && <div className="px-6 py-4 text-xs text-faint">Loading…</div>}
      {projects.error && <div className="px-6 py-4 text-xs text-err">{projects.error}</div>}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "err" }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-faint">{label}</div>
      <div className={`mt-0.5 text-base font-semibold ${tone === "ok" ? "text-ok" : tone === "err" ? "text-err" : "text-fg"}`}>{value}</div>
    </div>
  );
}
