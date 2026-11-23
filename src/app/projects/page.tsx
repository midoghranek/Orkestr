"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, Film, Search } from "lucide-react";
import { ago, useApi } from "@/lib/api";
import { Empty, ErrorNote, Input, PageHeader, Skeleton, StatusBadge } from "@/components/ui";
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

export default function Projects() {
  const { data, error } = useApi<ProjectRow[]>("/api/projects");
  const [q, setQ] = useState("");
  const shown = useMemo(() => (data ?? []).filter((p) => !q || `${p.name} ${p.description}`.toLowerCase().includes(q.toLowerCase())), [data, q]);
  return (
    <div className="pb-12">
      <PageHeader eyebrow="Workspace" title="Projects" sub="Every project keeps its own storyboard, workflows, assets and spend." actions={<NewProjectButton size="lg" />} />
      <div className="space-y-5 px-4 sm:px-6 lg:px-8">
        <ErrorNote>{error}</ErrorNote>
        {!!data?.length && data.length > 3 && (
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter projects" aria-label="Filter projects" className="pl-9" />
          </div>
        )}
        {data?.length === 0 && (
          <Empty title="No projects yet" icon={<Film className="size-6" />} action={<NewProjectButton />}>
            A project holds a brief, the AI Director&apos;s plans, the storyboard, workflows, assets and spend.
          </Empty>
        )}
        {data && data.length > 0 && shown.length === 0 && <Empty title="No match">Nothing matches “{q}”.</Empty>}
        <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {!data && !error && [0, 1, 2].map((i) => <Skeleton key={i} className="h-40 rounded-card" />)}
          {shown.map((p, i) => (
            <li key={p.id}>
              <Link href={`/projects/${p.slug}`} className="nb-lift group flex h-full flex-col overflow-hidden rounded-card border-2 border-ink bg-panel shadow-brut">
                <div className={`h-2 border-b-2 border-ink ${["bg-accent", "bg-paid-fill", "bg-ok-fill", "bg-err-fill", "bg-info-fill"][i % 5]}`} aria-hidden />
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="min-w-0 font-display text-[20px] font-bold leading-tight tracking-[-0.01em]">{p.name}</h2>
                    <ArrowUpRight className="size-5 shrink-0 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[13px] text-muted" dir="auto">
                    {p.description || "No description"}
                  </p>
                  <dl className="mt-4 grid grid-cols-3 gap-2 border-t-2 border-line pt-3">
                    {(
                      [
                        ["Flows", p.stats.workflows],
                        ["Runs", p.stats.runs],
                        ["Assets", p.stats.assets],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k}>
                        <dt className="nb-label text-faint">{k}</dt>
                        <dd className="font-display text-[22px] font-bold tabular-nums leading-tight">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-auto flex items-center justify-between gap-2 pt-3 text-[12px] text-faint">
                    <span>Updated {ago(p.updatedAt)}</span>
                    {p.stats.lastRunStatus && <StatusBadge status={p.stats.lastRunStatus} />}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
