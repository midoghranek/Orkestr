"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useCallback, useRef } from "react";
import type { OrkEvent } from "@/lib/api";
import { cn } from "@/components/ui";
import { useApi } from "@/lib/api";
import { ProjectContext, type Overview } from "@/components/project-context";

const TABS = [
  { seg: "", label: "Overview" },
  { seg: "director", label: "AI Director" },
  { seg: "storyboard", label: "Storyboard" },
  { seg: "flows", label: "Flows" },
  { seg: "assets", label: "Assets" },
  { seg: "preview", label: "Preview" },
];

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const path = usePathname() ?? "";
  const pidRef = useRef<string | undefined>(undefined);
  const onEvent = useCallback((e: OrkEvent) => !!e.project_id && e.project_id === pidRef.current && !e.type.startsWith("node.log"), []);
  const ov = useApi<Overview>(`/api/projects/${id}`, { refreshMs: 20_000, events: onEvent });
  pidRef.current = ov.data?.project.id;
  const base = `/projects/${id}`;
  const active = path === base ? "" : path.slice(base.length + 1).split("/")[0];
  return (
    <ProjectContext.Provider value={ov}>
      <div className="flex min-h-full flex-col">
        <div className="border-b border-line bg-panel/60 px-6 pt-4">
          <div className="flex items-center gap-2 text-xs text-faint">
            <Link href="/projects" className="hover:text-fg">
              Projects
            </Link>
            <span>/</span>
            <span className="text-muted">{ov.data?.project.name ?? "…"}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <h1 className="text-lg font-semibold tracking-tight">{ov.data?.project.name ?? " "}</h1>
            {ov.data && <span className="truncate text-xs text-muted">{ov.data.project.description}</span>}
          </div>
          <nav className="mt-3 flex gap-0.5">
            {TABS.map((t) => (
              <Link
                key={t.seg}
                href={t.seg ? `${base}/${t.seg}` : base}
                className={cn("-mb-px border-b-2 px-3 py-2 text-[13px]", active === t.seg ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}
              >
                {t.label}
                {t.seg === "" && !!ov.data?.approvals.length && <span className="ml-1.5 rounded bg-accent px-1 text-[10px] font-semibold text-accent-fg">{ov.data.approvals.length}</span>}
              </Link>
            ))}
          </nav>
        </div>
        {ov.error && !ov.data ? <div className="p-6 text-sm text-err">{ov.error}</div> : <div className="min-h-0 flex-1">{children}</div>}
      </div>
    </ProjectContext.Provider>
  );
}
