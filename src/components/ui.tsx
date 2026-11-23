"use client";

import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import React from "react";
import { assetUrl } from "@/lib/api";

export function cn(...a: Parameters<typeof clsx>) {
  return twMerge(clsx(...a));
}

export function Button({
  variant = "default",
  size = "md",
  className,
  busy,
  children,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" | "danger" | "outline"; size?: "sm" | "md"; busy?: boolean }) {
  return (
    <button
      {...p}
      disabled={p.disabled || busy}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]",
        variant === "primary" && "bg-accent text-accent-fg hover:brightness-110",
        variant === "default" && "bg-panel-2 text-fg border border-line hover:bg-line",
        variant === "outline" && "border border-line-strong text-fg hover:bg-panel-2",
        variant === "ghost" && "text-muted hover:text-fg hover:bg-panel-2",
        variant === "danger" && "bg-err/15 text-err border border-err/30 hover:bg-err/25",
        className,
      )}
    >
      {busy && <Spinner className="size-3" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent", className)} aria-label="loading" />;
}

export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...p} className={cn("rounded-lg border border-line bg-panel", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, sub, actions, className }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 border-b border-line px-4 py-3", className)}>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-fg">{title}</div>
        {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

const STATUS: Record<string, string> = {
  completed: "bg-ok/15 text-ok border-ok/30",
  healthy: "bg-ok/15 text-ok border-ok/30",
  approved: "bg-ok/15 text-ok border-ok/30",
  running: "bg-info/15 text-info border-info/30",
  validating: "bg-info/15 text-info border-info/30",
  generating: "bg-info/15 text-info border-info/30",
  queued: "bg-line text-muted border-line-strong",
  pending: "bg-line/60 text-faint border-line",
  draft: "bg-line/60 text-muted border-line",
  review: "bg-accent/15 text-accent border-accent/30",
  waiting_approval: "bg-accent/15 text-accent border-accent/30",
  degraded: "bg-warn/15 text-warn border-warn/30",
  unconfigured: "bg-line text-muted border-line-strong",
  failed: "bg-err/15 text-err border-err/30",
  rejected: "bg-err/15 text-err border-err/30",
  unavailable: "bg-err/10 text-err/80 border-err/25",
  cancelled: "bg-line text-faint border-line",
  skipped: "bg-line/40 text-faint border-line",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded border px-1.5 text-[11px] font-medium leading-none", STATUS[status] ?? STATUS.draft, className)}>
      {status === "running" && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function Pill({ children, tone = "default", className, title }: { children: React.ReactNode; tone?: "default" | "paid" | "ok" | "warn" | "err" | "info"; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium",
        tone === "default" && "bg-panel-2 text-muted",
        tone === "paid" && "bg-paid/15 text-paid",
        tone === "ok" && "bg-ok/15 text-ok",
        tone === "warn" && "bg-warn/15 text-warn",
        tone === "err" && "bg-err/15 text-err",
        tone === "info" && "bg-info/15 text-info",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Progress({ value, indeterminate, className, tone = "accent" }: { value?: number; indeterminate?: boolean; className?: string; tone?: "accent" | "ok" | "err" | "info" }) {
  const color = tone === "ok" ? "bg-ok" : tone === "err" ? "bg-err" : tone === "info" ? "bg-info" : "bg-accent";
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-line", className)}>
      {indeterminate ? <div className={cn("h-full w-2/5 rounded-full animate-indeterminate", color)} /> : <div className={cn("h-full rounded-full transition-[width] duration-500", color)} style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-faint">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-[13px] text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none";

export function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn(inputCls, "h-8", p.className)} />;
}

export function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cn(inputCls, "min-h-20 resize-y leading-relaxed", p.className)} />;
}

export function Select({ options, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select {...p} className={cn(inputCls, "h-8", p.className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <div className="text-sm font-medium text-fg">{title}</div>
      {children && <div className="max-w-md text-xs leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <div className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-xs text-err">{children}</div>;
}

export function Notice({ tone = "info", children, className }: { tone?: "info" | "warn" | "ok"; children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-xs leading-relaxed",
        tone === "info" && "border-info/25 bg-info/10 text-info",
        tone === "warn" && "border-warn/25 bg-warn/10 text-warn",
        tone === "ok" && "border-ok/25 bg-ok/10 text-ok",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface AssetLite {
  id: string;
  kind: string;
  label: string;
  mime: string;
  width: number | null;
  height: number | null;
  durationS: number | null;
}

/** Inline preview for any asset kind. */
export function AssetPreview({ asset, className, controls = true }: { asset: AssetLite; className?: string; controls?: boolean }) {
  const src = assetUrl(asset.id);
  if (asset.kind === "image") return <img src={src} alt={asset.label} className={cn("h-full w-full object-contain", className)} loading="lazy" />;
  if (asset.kind === "video") return <video src={src} className={cn("h-full w-full bg-black object-contain", className)} controls={controls} preload="metadata" muted={!controls} playsInline />;
  if (asset.kind === "audio") return <audio src={src} controls className={cn("w-full", className)} preload="metadata" />;
  return (
    <div className={cn("flex h-full w-full items-center justify-center bg-panel-2 p-2 text-center text-[11px] text-muted", className)}>
      <span>
        {asset.kind.toUpperCase()}
        <br />
        {asset.label}
      </span>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: React.ReactNode }[]; className?: string }) {
  return (
    <div className={cn("flex items-center gap-0.5 border-b border-line", className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn("-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors", value === t.value ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Small, non-blocking toast stack. */
type Toast = { id: number; tone: "ok" | "err" | "info"; text: string };
const toastListeners = new Set<(t: Toast[]) => void>();
let toasts: Toast[] = [];
export function toast(text: string, tone: Toast["tone"] = "info") {
  const t = { id: Date.now() + Math.random(), tone, text };
  toasts = [...toasts, t].slice(-4);
  toastListeners.forEach((l) => l(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastListeners.forEach((l) => l(toasts));
  }, tone === "err" ? 7000 : 3500);
}
export function Toaster() {
  const [list, setList] = React.useState<Toast[]>([]);
  React.useEffect(() => {
    toastListeners.add(setList);
    return () => void toastListeners.delete(setList);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2">
      {list.map((t) => (
        <div key={t.id} className={cn("pointer-events-auto rounded-md border px-3 py-2 text-xs shadow-lg backdrop-blur", t.tone === "ok" && "border-ok/30 bg-panel/95 text-ok", t.tone === "err" && "border-err/30 bg-panel/95 text-err", t.tone === "info" && "border-line bg-panel/95 text-fg")}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 px-6 pb-4 pt-6">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-fg">{title}</h1>
        {sub && <div className="mt-1 text-[13px] text-muted">{sub}</div>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
