"use client";

import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import React from "react";
import { AlertTriangle, Ban, Check, CircleDashed, Clock, Hourglass, Info, Loader, Pause, X } from "lucide-react";
import { assetUrl } from "@/lib/api";

export function cn(...a: Parameters<typeof clsx>) {
  return twMerge(clsx(...a));
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = "default" | "primary" | "ghost" | "danger" | "outline" | "ink";

const BTN_BASE =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-ctl font-semibold select-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:shrink-0";

export const btnVariants: Record<ButtonVariant, string> = {
  primary: "nb-press border-2 border-ink bg-accent text-ink shadow-brut-sm",
  default: "nb-press border-2 border-ink bg-panel text-ink shadow-brut-xs hover:bg-white",
  outline: "nb-press border-2 border-ink bg-transparent text-ink hover:bg-panel",
  ink: "nb-press border-2 border-ink bg-ink text-cream shadow-brut-accent",
  danger: "nb-press border-2 border-ink bg-err-fill text-ink shadow-brut-xs",
  ghost: "border-2 border-transparent text-muted transition-colors hover:border-ink/15 hover:bg-panel-2 hover:text-ink",
};

export function btnCls(variant: ButtonVariant = "default", size: "sm" | "md" | "lg" = "md", className?: string) {
  return cn(BTN_BASE, size === "sm" ? "h-8 px-2.5 text-xs" : size === "lg" ? "h-12 px-5 text-[15px]" : "h-10 px-3.5 text-[13px]", btnVariants[variant], className);
}

export function Button({
  variant = "default",
  size = "md",
  className,
  busy,
  children,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "sm" | "md" | "lg"; busy?: boolean }) {
  return (
    <button type="button" {...p} disabled={p.disabled || busy} aria-busy={busy || undefined} className={btnCls(variant, size, className)}>
      {busy && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

/** Square icon-only button. `label` is required for screen readers. */
export function IconButton({ label, className, children, variant = "ghost", ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: ButtonVariant }) {
  return (
    <button type="button" aria-label={label} title={label} {...p} className={cn(BTN_BASE, "size-9 p-0", btnVariants[variant], className)}>
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader className={cn("inline-block size-4 animate-spin", className)} aria-label="loading" role="status" />;
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

/** Card: ink outline + hard shadow. `flat` drops the shadow for nested/secondary panels. */
export function Card({ className, children, flat, ...p }: React.HTMLAttributes<HTMLDivElement> & { flat?: boolean }) {
  return (
    <div {...p} className={cn("rounded-card border-2 border-ink bg-panel", flat ? "" : "shadow-brut", className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, sub, actions, className, eyebrow }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; className?: string; eyebrow?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b-2 border-ink px-4 py-3", className)}>
      <div className="min-w-0 flex-1 basis-48">
        {eyebrow && <div className="nb-label mb-0.5 text-faint">{eyebrow}</div>}
        <h2 className="font-display text-[17px] font-bold leading-tight tracking-[-0.01em] text-ink">{title}</h2>
        {sub && <div className="mt-0.5 text-[13px] leading-snug text-muted">{sub}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Small mono uppercase label, e.g. section eyebrows. */
export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("nb-label text-faint", className)}>{children}</span>;
}

/** Text link style (yellow underline that turns ink on hover). Apply to <Link>/<a>. */
export const linkCls =
  "inline-flex min-h-8 items-center gap-1 rounded-sm text-[13px] font-semibold text-ink underline decoration-accent decoration-[3px] underline-offset-4 transition-colors hover:decoration-ink";

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

type Tone = "ok" | "run" | "wait" | "idle" | "warn" | "err" | "muted";
const TONE_CLS: Record<Tone, string> = {
  ok: "bg-ok-fill text-ink",
  run: "bg-info-fill text-ink",
  wait: "bg-accent text-ink",
  idle: "bg-panel text-ink",
  warn: "bg-warn-fill text-ink",
  err: "bg-err-fill text-ink",
  muted: "bg-panel-2 text-muted border-ink/40",
};
const STATUS: Record<string, { tone: Tone; icon: React.ComponentType<{ className?: string }> }> = {
  completed: { tone: "ok", icon: Check },
  healthy: { tone: "ok", icon: Check },
  approved: { tone: "ok", icon: Check },
  running: { tone: "run", icon: Loader },
  validating: { tone: "run", icon: Loader },
  generating: { tone: "run", icon: Loader },
  queued: { tone: "idle", icon: Clock },
  pending: { tone: "muted", icon: CircleDashed },
  draft: { tone: "muted", icon: CircleDashed },
  review: { tone: "wait", icon: Hourglass },
  waiting_approval: { tone: "wait", icon: Pause },
  degraded: { tone: "warn", icon: AlertTriangle },
  unconfigured: { tone: "muted", icon: CircleDashed },
  failed: { tone: "err", icon: X },
  rejected: { tone: "err", icon: X },
  unavailable: { tone: "err", icon: Ban },
  cancelled: { tone: "muted", icon: Ban },
  skipped: { tone: "muted", icon: CircleDashed },
};

/** Status chip: colour + icon + word, so state never relies on colour alone. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? STATUS.draft;
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full border-[1.5px] border-ink px-2 font-mono text-[11px] font-semibold uppercase leading-none tracking-wide", TONE_CLS[s.tone], className)}>
      <Icon className={cn("size-3", Icon === Loader && "animate-spin [animation-duration:1.6s]")} aria-hidden />
      {status.replace(/_/g, " ")}
    </span>
  );
}

export function Pill({ children, tone = "default", className, title }: { children: React.ReactNode; tone?: "default" | "paid" | "ok" | "warn" | "err" | "info" | "accent"; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 max-w-full shrink-0 items-center gap-1 rounded-ctl border-[1.5px] px-1.5 text-[12px] font-medium leading-none",
        tone === "default" && "border-ink/30 bg-panel text-ink",
        tone === "paid" && "border-ink bg-paid-fill text-ink",
        tone === "ok" && "border-ink bg-ok-fill text-ink",
        tone === "warn" && "border-ink bg-warn-fill text-ink",
        tone === "err" && "border-ink bg-err-fill text-ink",
        tone === "info" && "border-ink bg-info-fill text-ink",
        tone === "accent" && "border-ink bg-accent text-ink",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Chunky progress bar. Indeterminate = moving hazard stripes. */
export function Progress({ value, indeterminate, className, tone = "accent", label }: { value?: number; indeterminate?: boolean; className?: string; tone?: "accent" | "ok" | "err" | "info"; label?: string }) {
  const color = tone === "ok" ? "bg-mint" : tone === "err" ? "bg-coral" : tone === "info" ? "bg-info-fill" : "bg-accent";
  const pct = Math.round(Math.min(1, Math.max(0, value ?? 0)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label ?? "progress"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
      className={cn("h-2.5 w-full overflow-hidden rounded-full border-[1.5px] border-ink bg-panel", className)}
    >
      {indeterminate ? (
        <div className="nb-stripes h-full w-full animate-stripes opacity-80" />
      ) : (
        <div className={cn("h-full border-r-[1.5px] border-ink transition-[width] duration-500", color, pct === 0 && "border-r-0")} style={{ width: `${pct}%` }} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Forms                                                               */
/* ------------------------------------------------------------------ */

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="nb-label mb-1.5 block text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-[12px] leading-snug text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-ctl border-2 border-ink bg-white/70 px-3 py-2 text-[14px] text-ink placeholder:text-faint transition-shadow focus:bg-white focus:shadow-brut-accent focus:outline-none focus-visible:outline-none disabled:opacity-50";

export function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cn(inputCls, "h-10", p.className)} />;
}

export function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cn(inputCls, "min-h-24 resize-y leading-relaxed", p.className)} />;
}

export function Select({ options, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select
      {...p}
      className={cn(
        inputCls,
        "h-10 cursor-pointer appearance-none py-0 bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8",
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' fill='none' stroke='%2317140f' stroke-width='2'/%3E%3C/svg%3E\")]",
        p.className,
      )}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export function Empty({ title, children, action, icon }: { title: string; children?: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-ink/50 bg-panel/60 px-6 py-10 text-center">
      {icon && <div className="mb-1 flex size-12 items-center justify-center rounded-full border-2 border-ink bg-accent shadow-brut-xs">{icon}</div>}
      <div className="font-display text-[16px] font-bold text-ink">{title}</div>
      {children && <div className="max-w-md text-[13px] leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="flex gap-2 rounded-ctl border-2 border-ink bg-err-fill px-3 py-2 text-[13px] text-ink">
      <X className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export function Notice({ tone = "info", children, className }: { tone?: "info" | "warn" | "ok"; children: React.ReactNode; className?: string }) {
  const Icon = tone === "warn" ? AlertTriangle : tone === "ok" ? Check : Info;
  return (
    <div
      className={cn(
        "flex gap-2 rounded-ctl border-2 border-ink px-3 py-2.5 text-[13px] leading-relaxed text-ink",
        tone === "info" && "bg-info-fill",
        tone === "warn" && "bg-warn-fill",
        tone === "ok" && "bg-ok-fill",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-ctl bg-panel-2", className)} aria-hidden />;
}

/** Placeholder rows shown while a list loads — keeps layout stable instead of "Loading…" text. */
export function LoadingRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2 p-4", className)} role="status" aria-label="loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9" />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

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
  if (asset.kind === "video") return <video src={src} className={cn("h-full w-full bg-ink object-contain", className)} controls={controls} preload="metadata" muted={!controls} playsInline />;
  if (asset.kind === "audio") return <audio src={src} controls className={cn("w-full", className)} preload="metadata" />;
  return (
    <div className={cn("flex h-full w-full items-center justify-center bg-panel-2 p-2 text-center text-[12px] text-muted", className)}>
      <span>
        <span className="nb-label text-ink">{asset.kind}</span>
        <br />
        {asset.label}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

/** Segmented tabs: an ink rail with a yellow sticker on the active tab. Arrow keys move between tabs. */
export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: React.ReactNode }[]; className?: string }) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + tabs.length) % tabs.length;
    refs.current[n]?.focus();
    onChange(tabs[n].value);
  };
  return (
    <div className={cn("flex max-w-full items-center gap-1 overflow-x-auto p-1", className)} role="tablist">
      {tabs.map((t, i) => (
        <button
          key={t.value}
          ref={(el) => void (refs.current[i] = el)}
          type="button"
          role="tab"
          tabIndex={value === t.value ? 0 : -1}
          aria-selected={value === t.value}
          onKeyDown={(e) => onKey(e, i)}
          onClick={() => onChange(t.value)}
          className={cn(
            "h-8 shrink-0 whitespace-nowrap rounded-ctl border-2 px-3 text-[13px] font-semibold transition-colors",
            value === t.value ? "border-ink bg-accent text-ink shadow-brut-xs" : "border-transparent text-muted hover:border-ink/20 hover:bg-panel-2 hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog / Sheet                                                      */
/* ------------------------------------------------------------------ */

/** Escape-to-close + focus restore + simple focus trap for overlays. */
export function useOverlay(open: boolean, onClose: () => void) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])') ?? []);
    if (el && !el.contains(document.activeElement)) (el.querySelector<HTMLElement>("[autofocus]") ?? focusables()[0] ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab" && el) {
        const f = focusables();
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) (e.preventDefault(), f[f.length - 1].focus());
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) (e.preventDefault(), f[0].focus());
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  return ref;
}

export function Dialog({ open, onClose, title, children, footer, className }: { open: boolean; onClose: () => void; title: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; className?: string }) {
  const ref = useOverlay(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={cn("flex max-h-[92dvh] w-full max-w-lg animate-rise flex-col rounded-t-sheet border-2 border-ink bg-panel shadow-brut-xl outline-none sm:rounded-sheet", className)}
      >
        <div className="flex items-center justify-between gap-3 border-b-2 border-ink px-5 py-4">
          <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t-2 border-ink px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Side sheet (inspector/detail drawer). Full-width on phones. */
export function Sheet({ onClose, children, className, label }: { onClose: () => void; children: React.ReactNode; className?: string; label: string }) {
  const ref = useOverlay(true, onClose);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className={cn("flex h-full w-full max-w-md flex-col border-l-2 border-ink bg-panel shadow-[-8px_0_0_0_var(--color-ink)] outline-none", className)}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

type Toast = { id: number; tone: "ok" | "err" | "info"; text: string };
const toastListeners = new Set<(t: Toast[]) => void>();
let toasts: Toast[] = [];
function dismiss(id: number) {
  toasts = toasts.filter((x) => x.id !== id);
  toastListeners.forEach((l) => l(toasts));
}
export function toast(text: string, tone: Toast["tone"] = "info") {
  const t = { id: Date.now() + Math.random(), tone, text };
  toasts = [...toasts, t].slice(-4);
  toastListeners.forEach((l) => l(toasts));
  setTimeout(() => dismiss(t.id), tone === "err" ? 8000 : 4000);
}
export function Toaster() {
  const [list, setList] = React.useState<Toast[]>([]);
  React.useEffect(() => {
    toastListeners.add(setList);
    return () => void toastListeners.delete(setList);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-20 z-[60] flex flex-col items-end gap-2 md:inset-x-auto md:bottom-5 md:right-5 md:w-96" aria-live="polite" role="status">
      {list.map((t) => {
        const Icon = t.tone === "ok" ? Check : t.tone === "err" ? X : Info;
        return (
          <div key={t.id} className="pointer-events-auto flex w-full animate-rise items-stretch overflow-hidden rounded-ctl border-2 border-ink bg-panel text-[13px] text-ink shadow-brut">
            <span className={cn("flex w-9 shrink-0 items-center justify-center border-r-2 border-ink", t.tone === "ok" ? "bg-mint" : t.tone === "err" ? "bg-coral" : "bg-accent")}>
              <Icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1 break-words px-3 py-2.5">{t.text}</span>
            <button type="button" onClick={() => dismiss(t.id)} className="px-2 text-muted hover:text-ink" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page structure                                                      */
/* ------------------------------------------------------------------ */

export function PageHeader({ title, sub, actions, eyebrow }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-4 pb-5 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      <div className="min-w-0">
        {eyebrow && <div className="nb-label mb-2 inline-flex items-center gap-2 text-muted">{eyebrow}</div>}
        <h1 className="font-display text-[34px] font-extrabold leading-[0.95] tracking-[-0.03em] text-ink sm:text-[44px]">{title}</h1>
        {sub && <div className="mt-2 max-w-2xl text-[15px] leading-snug text-muted">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** KPI tile for dashboards. */
export function Stat({ label, value, hint, tone = "default", icon, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "ok" | "err" | "accent" | "paid" | "info"; icon?: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-full flex-col justify-between gap-3 rounded-card border-2 border-ink p-4 shadow-brut",
        tone === "default" && "bg-panel",
        tone === "ok" && "bg-ok-fill",
        tone === "err" && "bg-err-fill",
        tone === "accent" && "bg-accent",
        tone === "paid" && "bg-paid-fill",
        tone === "info" && "bg-info-fill",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="nb-label text-ink/75">{label}</span>
        {icon && <span className="text-ink [&_svg]:size-5">{icon}</span>}
      </div>
      <div>
        <div className="font-display text-[32px] font-extrabold leading-none tracking-[-0.03em] text-ink tabular-nums">{value}</div>
        {hint && <div className="mt-1.5 text-[12px] leading-snug text-ink/75">{hint}</div>}
      </div>
    </div>
  );
}

/** The Orkestr mark: a yellow tile with three "tracks" of different length — parallel jobs being conducted. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-8", className)} aria-hidden>
      <rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="var(--color-accent)" stroke="var(--color-ink)" strokeWidth="3" />
      <rect x="7" y="8.5" width="18" height="3.5" rx="1.75" fill="var(--color-ink)" />
      <rect x="7" y="14.25" width="11" height="3.5" rx="1.75" fill="var(--color-ink)" />
      <rect x="7" y="20" width="15" height="3.5" rx="1.75" fill="var(--color-ink)" />
      <circle cx="23" cy="16" r="2.4" fill="var(--color-ink)" />
    </svg>
  );
}
