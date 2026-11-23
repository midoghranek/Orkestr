"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, Gauge, ListVideo, Settings, Workflow } from "lucide-react";
import { cn, Toaster } from "./ui";
import { useApi, type OrkEvent } from "@/lib/api";

const NAV = [
  { href: "/", label: "Dashboard", icon: Gauge, match: (p: string) => p === "/" },
  { href: "/projects", label: "Projects", icon: Clapperboard, match: (p: string) => p.startsWith("/projects") },
  { href: "/queue", label: "Render Queue", icon: ListVideo, match: (p: string) => p.startsWith("/queue") },
  { href: "/settings", label: "Settings", icon: Settings, match: (p: string) => p.startsWith("/settings") },
];

const onApproval = (e: OrkEvent) => e.type.startsWith("approval") || e.type.startsWith("node.") || e.type.startsWith("run.");

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  const { data: sys } = useApi<{ worker: { alive: boolean } }>("/api/system", { refreshMs: 10_000 });
  const { data: pending } = useApi<unknown[]>("/api/approvals?status=pending", { events: onApproval, refreshMs: 15_000 });
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-52 shrink-0 flex-col border-r border-line bg-panel">
        <Link href="/" className="flex items-center gap-2 px-4 py-4">
          <span className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-fg">
            <Workflow className="size-4" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Orkestr</span>
        </Link>
        <nav className="flex flex-col gap-0.5 px-2">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors", n.match(path) ? "bg-panel-2 text-fg" : "text-muted hover:bg-panel-2/60 hover:text-fg")}>
              <n.icon className="size-4" />
              <span className="flex-1">{n.label}</span>
              {n.href === "/queue" && !!pending?.length && <span className="rounded bg-accent px-1.5 text-[10px] font-semibold text-accent-fg">{pending.length}</span>}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-line px-4 py-3 text-[11px] text-faint">
          <div className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", sys === undefined ? "bg-faint" : sys.worker.alive ? "bg-ok" : "bg-err")} />
            {sys === undefined ? "checking worker…" : sys.worker.alive ? "worker running" : "worker offline — run npm run dev"}
          </div>
          <div className="mt-1">127.0.0.1 · local only</div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      <Toaster />
    </div>
  );
}
