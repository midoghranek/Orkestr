"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { ArrowRight, Globe, ImagePlus, Loader, Paperclip, Sparkles, X } from "lucide-react";
import { api, ago, assetUrl, useApi, type OrkEvent } from "@/lib/api";
import { Button, Notice, Skeleton, StatusBadge, cn, linkCls, toast } from "@/components/ui";

interface Recipe {
  id: string;
  label: string;
  pitch: string;
  examples: string[];
  deliverables: { name: string; aspect: string; durationS: number; kind: string }[];
}
interface ProjectCard {
  id: string;
  slug: string;
  name: string;
  brief: string;
  updatedAt: number;
  cover: { id: string; kind: string } | null;
  production: { id: string; status: string; updatedAt: number } | null;
  stats: { runs: number; lastRunStatus: string | null };
}
interface Readiness {
  ready: boolean;
  core: { id: string; label: string; ok: boolean; fix: string }[];
  optional: { id: string; label: string; ok: boolean; why: string; fix: string }[];
}
interface Approval {
  id: string;
  projectId: string;
  projectName?: string;
  title: string;
  kind: string;
}

const STATUS_WORDS: Record<string, string> = {
  researching: "Reading the website",
  planning: "Writing the direction",
  direction: "Direction ready for you",
  producing: "Producing",
  done: "Ready",
  failed: "Needs attention",
};

const URL_RE = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|ai|app|co|net|org|dev|eg|me|so|xyz|shop|store)(?:\/[^\s"'<>]*)?/i;

export default function CreateHome() {
  const router = useRouter();
  const recipes = useApi<Recipe[]>("/api/recipes");
  const projects = useApi<ProjectCard[]>("/api/projects", { events: (e: OrkEvent) => e.type.startsWith("production.") || e.type === "run.completed" });
  const ready = useApi<Readiness>("/api/readiness", { refreshMs: 60_000 });
  const approvals = useApi<Approval[]>("/api/approvals?status=pending", { events: (e: OrkEvent) => e.type.startsWith("approval") });
  const sys = useApi<{ worker: { alive: boolean } }>("/api/system", { refreshMs: 15_000 });
  const [prompt, setPrompt] = useState("");
  const [url, setUrl] = useState("");
  const [recipe, setRecipe] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [quick, setQuick] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const detectedUrl = useMemo(() => (url ? "" : (prompt.match(URL_RE)?.[0] ?? "")), [prompt, url]);
  const aiReady = !!ready.data?.optional.find((o) => o.id === "ai")?.ok;
  const canCreate = prompt.trim().length >= 3 && !busy;

  const create = async () => {
    if (!canCreate) return;
    setBusy(true);
    try {
      let projectId: string | undefined;
      const assetIds: string[] = [];
      if (files.length) {
        // Files need a project to live in: create it first, then the production picks them up by role.
        const p = await api<{ id: string }>("/api/projects", { method: "POST", json: { name: "New creation", brief: prompt } }); // renamed from the request by /api/create
        projectId = p.id;
        const form = new FormData();
        files.forEach((f) => form.append("file", f, f.name));
        const up = await api<{ id: string }[]>(`/api/projects/${p.id}/assets/upload`, { method: "POST", body: form });
        assetIds.push(...up.map((a) => a.id));
      }
      const r = await api<{ slug: string; reason: string }>("/api/create", {
        method: "POST",
        json: { prompt, url: url || undefined, recipeId: recipe ?? undefined, projectId, assetIds, planner: quick || !aiReady ? "recipe" : "auto" },
      });
      router.push(`/projects/${r.slug}`);
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy(false);
    }
  };

  const recent = (projects.data ?? []).slice(0, 6);
  const workerDown = sys.data && !sys.data.worker.alive;
  const notReady = ready.data && !ready.data.ready;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-8 sm:px-6 sm:pt-14 lg:px-8">
      {(workerDown || notReady) && (
        <Notice tone="warn" className="mb-6">
          {workerDown ? (
            <>
              The production worker is not running, so nothing can render yet. Start Orkestr with <code className="font-mono">npm run dev</code>.
            </>
          ) : (
            <>
              Before your first video: {ready.data!.core.filter((c) => !c.ok).map((c) => `${c.label} — ${c.fix}`).join(" ")}{" "}
              <Link href="/settings" className={linkCls}>
                Open setup
              </Link>
            </>
          )}
        </Notice>
      )}

      <h1 className="font-display text-[34px] font-extrabold leading-[1.02] tracking-[-0.035em] text-ink sm:text-[52px]">What do you want to create today?</h1>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted sm:text-[16px]">
        Describe it in your own words. Add your website and Orkestr shows your real product; add photos or a logo and it uses them. You review the direction before anything is produced.
      </p>

      <form
        className="mt-7 rounded-sheet border-2 border-ink bg-panel shadow-brut-lg focus-within:shadow-brut-accent"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <label htmlFor="prompt" className="sr-only">
          Describe what you want to create
        </label>
        <textarea
          id="prompt"
          ref={taRef}
          dir="auto"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void create();
            }
          }}
          placeholder="e.g. A 30-second Instagram ad for my café in Egyptian Arabic, warm and premium"
          className="block min-h-32 w-full resize-y rounded-t-sheet bg-transparent px-5 pb-2 pt-5 text-[17px] leading-relaxed text-ink outline-none focus-visible:outline-none placeholder:text-faint sm:min-h-36 sm:text-[19px]"
          autoFocus
        />
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <div className="flex min-w-0 flex-1 basis-64 items-center gap-2 rounded-ctl border-2 border-ink/20 bg-white/60 px-2.5 focus-within:border-ink">
            <Globe className="size-4 shrink-0 text-muted" aria-hidden />
            <label htmlFor="url" className="sr-only">
              Website (optional)
            </label>
            <input
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={detectedUrl ? `Website: ${detectedUrl}` : "Your website (optional)"}
              className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint"
              inputMode="url"
              dir="ltr"
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 20));
              e.target.value = "";
            }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()} title="Photos, a logo, a music track or a recorded voiceover">
            <Paperclip className="size-4" /> Add photos, logo or music
          </Button>
          <Button variant="primary" size="lg" type="submit" disabled={!canCreate} busy={busy} className="ms-auto">
            <Sparkles className="size-4" /> Create
          </Button>
        </div>
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2 border-t-2 border-ink/10 px-4 py-3" aria-label="Attached files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-1.5 rounded-full border-2 border-ink bg-white px-2.5 py-0.5 text-[12px] font-semibold">
                <ImagePlus className="size-3.5" aria-hidden />
                <span className="max-w-44 truncate">{f.name}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} className="rounded-full p-0.5 hover:bg-panel-2">
                  <X className="size-3" />
                </button>
              </li>
            ))}
            <li className="self-center text-[12px] text-muted">Logos are detected by name (e.g. “logo.png”); you can change roles later.</li>
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t-2 border-ink/10 px-5 py-2.5 text-[12px] text-muted">
          {aiReady ? (
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} className="size-4 accent-ink" />
              Quick draft without AI (free, instant)
            </label>
          ) : ready.data ? (
            <span>The AI Director isn&apos;t set up, so Orkestr drafts with its free recipe planner and your words.</span>
          ) : (
            <span>&nbsp;</span>
          )}
          <span className="ms-auto hidden sm:inline">
            <kbd className="rounded border border-ink/30 px-1 font-mono">Ctrl</kbd> + <kbd className="rounded border border-ink/30 px-1 font-mono">Enter</kbd> to create
          </span>
          {aiReady && !quick && <span className="basis-full">The AI Director runs on your Claude plan; its actual cost is shown afterwards (capped in Setup).</span>}
        </div>
      </form>

      <section className="mt-8" aria-labelledby="recipes-h">
        <h2 id="recipes-h" className="nb-label text-faint">
          Or start from a recipe
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(recipes.data ?? []).map((r) => {
            const on = recipe === r.id;
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setRecipe(on ? null : r.id);
                  if (!prompt.trim()) setPrompt(r.examples[0] ?? "");
                  taRef.current?.focus();
                }}
                className={cn("nb-press flex flex-col gap-1.5 rounded-card border-2 border-ink p-4 text-left transition-colors", on ? "bg-accent shadow-brut-sm" : "bg-panel hover:bg-white")}
              >
                <span className="font-display text-[17px] font-bold leading-tight text-ink">{r.label}</span>
                <span className="text-[13px] leading-snug text-muted">{r.pitch}</span>
                <span className="mt-auto pt-1 font-mono text-[11px] text-faint">{r.deliverables.map((d) => (d.kind === "poster" ? `${d.aspect} poster` : `${d.aspect} · ${d.durationS}s`)).join("  ·  ")}</span>
              </button>
            );
          })}
          {!recipes.data && [0, 1, 2].map((i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </section>

      {!!approvals.data?.length && (
        <section className="mt-10" aria-labelledby="needs-h">
          <h2 id="needs-h" className="nb-label text-faint">
            Needs you
          </h2>
          <ul className="mt-3 divide-y-2 divide-ink/10 rounded-card border-2 border-ink bg-accent/25">
            {approvals.data.slice(0, 5).map((a) => (
              <li key={a.id}>
                <Link href={`/projects/${a.projectId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent/30">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold text-ink">{a.title}</span>
                    <span className="block text-[12px] text-muted">{a.projectName}</span>
                  </span>
                  <ArrowRight className="size-4 shrink-0" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10" aria-labelledby="recent-h">
        <div className="flex items-baseline justify-between">
          <h2 id="recent-h" className="nb-label text-faint">
            Continue working
          </h2>
          {(projects.data?.length ?? 0) > 6 && (
            <Link href="/projects" className={linkCls}>
              All projects
            </Link>
          )}
        </div>
        {projects.data && !recent.length && <p className="mt-3 text-[14px] text-muted">Your creations will appear here.</p>}
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {!projects.data && [0, 1, 2].map((i) => <Skeleton key={i} className="h-56" />)}
          {recent.map((p) => (
            <Link key={p.id} href={`/projects/${p.slug}`} className="nb-lift group flex flex-col overflow-hidden rounded-card border-2 border-ink bg-panel">
              <div className="relative aspect-video border-b-2 border-ink bg-ink">
                {p.cover ? (
                  p.cover.kind === "video" ? (
                    <video src={`${assetUrl(p.cover.id)}#t=1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  ) : (
                    <img src={assetUrl(p.cover.id)} alt="" loading="lazy" className="h-full w-full object-cover" />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center text-cream/40">
                    <Sparkles className="size-6" aria-hidden />
                  </div>
                )}
                {p.production && ["researching", "planning", "producing"].includes(p.production.status) && (
                  <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-full border-2 border-ink bg-panel px-2 text-[11px] font-semibold">
                    <Loader className="size-3 animate-spin" aria-hidden /> {STATUS_WORDS[p.production.status]}
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3.5">
                <span className="truncate font-display text-[16px] font-bold text-ink">{p.name}</span>
                <span className="line-clamp-2 text-[13px] leading-snug text-muted" dir="auto">
                  {p.brief || "—"}
                </span>
                <span className="mt-auto flex items-center justify-between pt-2 text-[12px] text-faint">
                  {p.production ? <span className="font-semibold text-ink">{STATUS_WORDS[p.production.status] ?? p.production.status}</span> : p.stats.lastRunStatus ? <StatusBadge status={p.stats.lastRunStatus} /> : <span>Not started</span>}
                  <span>{ago(p.production?.updatedAt ?? p.updatedAt)}</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
