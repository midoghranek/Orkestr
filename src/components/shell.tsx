"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clapperboard, LayoutDashboard, ListVideo, Settings, Sparkles, SlidersHorizontal } from "lucide-react";
import { cn, Logo, Toaster } from "./ui";
import { useApi, type OrkEvent } from "@/lib/api";
import { useMode } from "@/lib/mode";

const NAV = [
  { href: "/", label: "Create", short: "Create", icon: Sparkles, match: (p: string) => p === "/", pro: false },
  { href: "/projects", label: "Projects", short: "Projects", icon: Clapperboard, match: (p: string) => p.startsWith("/projects"), pro: false },
  { href: "/studio", label: "Control room", short: "Studio", icon: LayoutDashboard, match: (p: string) => p.startsWith("/studio"), pro: true },
  { href: "/queue", label: "Render queue", short: "Queue", icon: ListVideo, match: (p: string) => p.startsWith("/queue"), pro: true },
  { href: "/settings", label: "Setup", short: "Setup", icon: Settings, match: (p: string) => p.startsWith("/settings"), pro: false },
];

/** Switch between Simple mode and Studio Pro. Same projects and engine; Pro reveals the technical tools. */
export function ModeSwitch({ className, onInk = true }: { className?: string; onInk?: boolean }) {
  const [mode, setMode] = useMode();
  const pro = mode === "pro";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={pro}
      onClick={() => setMode(pro ? "simple" : "pro")}
      className={cn("flex w-full items-center gap-2.5 rounded-ctl border-2 px-3 py-2 text-left text-[13px] font-semibold", onInk ? "border-cream/15 text-cream hover:bg-ink-2" : "border-ink bg-panel text-ink hover:bg-white", className)}
      title="Studio Pro shows the flow editor, render queue, storyboard and logs. Your work is the same in both modes."
    >
      <SlidersHorizontal className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">Studio Pro</span>
      <span aria-hidden className={cn("relative h-5 w-9 shrink-0 rounded-full border-2 transition-colors", pro ? "border-accent bg-accent" : onInk ? "border-cream/40 bg-ink-2" : "border-ink bg-panel-2")}>
        <span className={cn("absolute top-0.5 size-3 rounded-full transition-[left]", pro ? "left-[18px] bg-ink" : "left-0.5", !pro && (onInk ? "bg-cream/70" : "bg-ink"))} />
      </span>
    </button>
  );
}

const onApproval = (e: OrkEvent) => e.type.startsWith("approval") || e.type.startsWith("node.") || e.type.startsWith("run.");

function WorkerDot({ alive }: { alive: boolean | undefined }) {
  return (
    <span className="relative flex size-2.5 shrink-0" aria-hidden>
      {alive && <span className="absolute inset-0 animate-ping rounded-full bg-mint opacity-60" />}
      <span className={cn("relative size-2.5 rounded-full border border-cream/40", alive === undefined ? "bg-faint" : alive ? "bg-mint" : "bg-coral")} />
    </span>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname() ?? "/";
  const { data: sys } = useApi<{ worker: { alive: boolean } }>("/api/system", { refreshMs: 10_000 });
  const { data: pending } = useApi<unknown[]>("/api/approvals?status=pending", { events: onApproval, refreshMs: 15_000 });
  const alive = sys?.worker.alive;
  const workerText = sys === undefined ? "Checking worker…" : alive ? "Worker running" : "Worker offline";
  const count = pending?.length ?? 0;
  const [mode] = useMode();
  const nav = NAV.filter((n) => !n.pro || mode === "pro");

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      <a href="#main" className="sr-only z-[70] rounded-ctl border-2 border-ink bg-accent px-3 py-2 font-semibold focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>

      {/* Desktop / tablet rail */}
      <aside className="on-ink hidden w-60 shrink-0 flex-col bg-ink text-cream md:flex">
        <Link href="/" className="flex items-center gap-2.5 px-5 pb-6 pt-5">
          <Logo className="size-9" />
          <span className="font-display text-[22px] font-extrabold tracking-[-0.03em]">Orkestr</span>
        </Link>
        <div className="nb-label px-5 pb-2 text-cream/55">Studio</div>
        <nav className="flex flex-col gap-1 px-3" aria-label="Main">
          {nav.map((n) => {
            const on = n.match(path);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "group flex h-11 items-center gap-3 rounded-ctl border-2 px-3 text-[14px] font-semibold transition-[background-color,transform] duration-100",
                  on ? "border-ink bg-accent text-ink shadow-[3px_3px_0_0_var(--color-cream)]" : "border-transparent text-cream/80 hover:bg-ink-2 hover:text-cream",
                )}
              >
                <n.icon className="size-[18px]" aria-hidden />
                <span className="flex-1">{n.label}</span>
                {n.href === (mode === "pro" ? "/queue" : "/projects") && count > 0 && (
                  <span className={cn("min-w-6 rounded-full border-2 px-1.5 text-center font-mono text-[11px] font-bold leading-5", on ? "border-ink bg-ink text-accent" : "border-ink bg-accent text-ink")} aria-label={`${count} waiting for approval`}>
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto space-y-2 p-3">
          <ModeSwitch />
          <div className={cn("rounded-ctl border-2 p-3 text-[12px]", alive === false ? "border-coral bg-coral/15" : "border-cream/15")}>
            <div className="flex items-center gap-2 font-semibold">
              <WorkerDot alive={alive} />
              {workerText}
            </div>
            {alive === false && (
              <div className="mt-1.5 leading-snug text-cream/80">
                Jobs won&apos;t run. Start it with <code className="rounded bg-ink-2 px-1 font-mono text-accent">npm run dev</code>
              </div>
            )}
            <div className="nb-label mt-2 text-cream/50">127.0.0.1 · local only</div>
          </div>
        </div>
      </aside>

      {/* Phone top bar */}
      <header className="on-ink flex h-14 shrink-0 items-center gap-2 border-b-2 border-ink bg-ink px-4 text-cream md:hidden">
        <Link href="/" className="flex items-center gap-2">
          <Logo className="size-8" />
          <span className="font-display text-[19px] font-extrabold tracking-[-0.03em]">Orkestr</span>
        </Link>
        <span className="ml-auto flex items-center gap-2 text-[12px] font-semibold" role="status">
          <WorkerDot alive={alive} />
          <span className={alive === false ? "text-coral" : "text-cream/80"}>{workerText.replace("Worker ", "")}</span>
        </span>
      </header>

      <main id="main" className="min-h-0 min-w-0 flex-1 overflow-y-auto pb-20 md:pb-0">
        {children}
      </main>

      {/* Phone bottom tab bar */}
      <nav className="on-ink fixed inset-x-0 bottom-0 z-30 grid border-t-2 border-ink bg-ink pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Main" style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}>
        {nav.map((n) => {
          const on = n.match(path);
          return (
            <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined} className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold">
              <span className={cn("relative flex h-8 w-12 items-center justify-center rounded-full border-2 transition-colors", on ? "border-cream bg-accent text-ink" : "border-transparent text-cream/75")}>
                <n.icon className="size-5" aria-hidden />
                {n.href === (mode === "pro" ? "/queue" : "/projects") && count > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full border-2 border-ink bg-coral px-1 text-center font-mono text-[10px] font-bold leading-4 text-ink" aria-label={`${count} waiting`}>
                    {count}
                  </span>
                )}
              </span>
              <span className={on ? "text-accent" : "text-cream/75"}>{n.short}</span>
            </Link>
          );
        })}
      </nav>
      <Toaster />
    </div>
  );
}
