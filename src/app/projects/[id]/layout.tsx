"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { ChevronRight, Clapperboard, FolderOpen, LayoutGrid, MonitorPlay, Sparkles, Wand2, Workflow } from "lucide-react";
import { useMode } from "@/lib/mode";
import { ModeSwitch } from "@/components/shell";
import type { OrkEvent } from "@/lib/api";
import { cn, ErrorNote, Skeleton } from "@/components/ui";
import { useApi } from "@/lib/api";
import { ProjectContext, type Overview } from "@/components/project-context";

// Simple mode shows only the workspace. Studio Pro adds the technical tabs in production order
// (plan → board → build → collect → review). Same project, engine and runs either way.
const TABS = [
  { seg: "", label: "Workspace", icon: Wand2 },
  { seg: "overview", label: "Overview", icon: LayoutGrid },
  { seg: "director", label: "AI Director", icon: Sparkles },
  { seg: "storyboard", label: "Storyboard", icon: Clapperboard },
  { seg: "flows", label: "Flows", icon: Workflow },
  { seg: "assets", label: "Assets", icon: FolderOpen },
  { seg: "preview", label: "Preview", icon: MonitorPlay },
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
  const activeRef = useRef<HTMLAnchorElement>(null);
  // On phones the tab strip scrolls; keep the current section in view.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);
  const inEditor = active === "flows" && path.split("/").length > 4;
  const [mode] = useMode();
  const pro = mode === "pro";
  const tabs = pro ? TABS : TABS.filter((t) => t.seg === "" || t.seg === active);
  return (
    <ProjectContext.Provider value={ov}>
      <div className="flex min-h-full flex-col">
        <div className={cn("border-b-2 border-ink bg-panel px-4 sm:px-6 lg:px-8", inEditor ? "pt-3" : "pt-5", tabs.length < 2 && "pb-4")}>
          <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[12px] font-semibold text-muted">
            <Link href="/projects" className="rounded-sm underline-offset-4 hover:text-ink hover:underline">
              Projects
            </Link>
            <ChevronRight className="size-3.5" aria-hidden />
            <span className="truncate text-ink" aria-current="page">
              {ov.data?.project.name ?? "…"}
            </span>
          </nav>
          {!inEditor && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-2">
              {ov.data ? (
                <h1 className="font-display text-[30px] font-extrabold leading-none tracking-[-0.03em] sm:text-[36px]">{ov.data.project.name}</h1>
              ) : (
                <Skeleton className="h-9 w-64" />
              )}
              {ov.data?.project.description && (
                <p className="min-w-0 max-w-2xl flex-1 truncate text-[14px] text-muted" dir="auto">
                  {ov.data.project.description}
                </p>
              )}
              <div className="ms-auto w-44">
                <ModeSwitch onInk={false} />
              </div>
            </div>
          )}
          <nav className={cn("-mx-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:px-0", inEditor ? "mt-2" : "mt-4")} aria-label="Project sections" hidden={tabs.length < 2 ? true : undefined}>
            {tabs.map((t) => {
              const on = active === t.seg;
              return (
                <Link
                  key={t.seg}
                  ref={on ? activeRef : undefined}
                  href={t.seg ? `${base}/${t.seg}` : base}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "relative -mb-[2px] flex h-11 shrink-0 items-center gap-2 rounded-t-ctl border-2 border-b-0 px-3.5 text-[14px] font-semibold transition-colors",
                    on ? "border-ink bg-bg text-ink after:absolute after:inset-x-0 after:-bottom-[2px] after:h-[2px] after:bg-bg" : "border-transparent text-muted hover:bg-panel-2 hover:text-ink",
                  )}
                >
                  <t.icon className={cn("size-4", on && "text-ink")} aria-hidden />
                  {t.label}
                  {t.seg === "" && !!ov.data?.approvals.length && (
                    <span className="min-w-5 rounded-full border-2 border-ink bg-accent px-1 text-center font-mono text-[10px] font-bold leading-4" aria-label={`${ov.data.approvals.length} waiting for approval`}>
                      {ov.data.approvals.length}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
        {ov.error && !ov.data ? (
          <div className="p-6">
            <ErrorNote>{ov.error}</ErrorNote>
          </div>
        ) : (
          <div className="flex min-h-0 flex-[1_1_0px] flex-col">{children}</div>
        )}
      </div>
    </ProjectContext.Provider>
  );
}
