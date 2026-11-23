"use client";

import Link from "next/link";
import { ago, useApi } from "@/lib/api";
import { Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
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
  return (
    <div className="pb-10">
      <PageHeader title="Projects" sub="Every project keeps its own storyboard, workflows, assets and spend." actions={<NewProjectButton />} />
      <div className="px-6">
        {error && <div className="text-xs text-err">{error}</div>}
        {data?.length === 0 && <Empty title="No projects yet" action={<NewProjectButton />} />}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data?.map((p) => (
            <Link key={p.id} href={`/projects/${p.slug}`}>
              <Card className="h-full p-4 transition-colors hover:border-line-strong">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[14px] font-semibold">{p.name}</div>
                  {p.stats.lastRunStatus && <StatusBadge status={p.stats.lastRunStatus} />}
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-muted">{p.description || "—"}</div>
                <div className="mt-3 flex gap-3 text-[11px] text-faint">
                  <span>{p.stats.workflows} flows</span>
                  <span>{p.stats.runs} runs</span>
                  <span>{p.stats.assets} assets</span>
                  <span className="ml-auto">updated {ago(p.updatedAt)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
