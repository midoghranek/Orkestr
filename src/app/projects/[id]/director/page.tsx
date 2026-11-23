"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { ago, api, assetUrl, fmtUsd, useApi } from "@/lib/api";
import { Button, Card, CardHeader, Empty, ErrorNote, Field, Input, LoadingRows, Notice, Pill, Progress, Select, Skeleton, StatusBadge, Textarea, toast, cn } from "@/components/ui";
import { useProject, type AssetFull } from "@/components/project-context";

interface Plan {
  title: string;
  logline: string;
  language: string;
  audience: string;
  tone: string;
  deliverables: { name: string; aspect: string; durationS: number }[];
  script: string;
  scenes: { title: string; durationS: number; narration: string; onScreenText: string; prompt: string; camera: string; constraints: string[]; references: string[]; visualSource: string; tool: string }[];
  voiceover: { needed: boolean; language: string; direction: string };
  music: string;
  questions: string[];
  risks: string[];
}
interface PlanRow {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  brief: string;
  error: string | null;
  model: string | null;
  cost_usd: number | null;
  created_at: number;
  finished_at: number | null;
  plan: Plan | null;
}

const UNPRODUCIBLE = ["generated-video", "generated-image", "stock", "placeholder"];

export default function DirectorPage() {
  const { data } = useProject();
  const pid = data?.project.id;
  const plans = useApi<PlanRow[]>(pid ? `/api/projects/${pid}/plans` : null, { events: (e) => e.type.startsWith("plan.") && e.project_id === pid, refreshMs: 10_000 });
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    if (data && !brief) setBrief(data.project.brief);
  }, [data, brief]);
  const current = plans.data?.find((p) => p.id === selected) ?? plans.data?.[0];

  const submit = async () => {
    if (!pid) return;
    setBusy(true);
    try {
      const r = await api<{ planId: string }>(`/api/projects/${pid}/plans`, { method: "POST", json: { brief } });
      setSelected(r.planId);
      await plans.reload();
      toast("The AI Director is planning (runs in the worker; usually 1–3 minutes)", "info");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  if (!data)
    return (
      <div className="grid gap-6 p-4 sm:p-6 lg:p-8 xl:grid-cols-[400px_1fr]">
        <Card>
          <LoadingRows rows={4} />
        </Card>
        <Skeleton className="h-64" />
      </div>
    );
  return (
    <div className="grid gap-6 p-4 sm:p-6 lg:p-8 xl:grid-cols-[400px_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardHeader eyebrow="Step 1" title="Brief" sub="Describe the goal. The Director plans only with verified tools and the project's verified claims." />
          <div className="space-y-3 p-4">
            <Textarea dir="auto" value={brief} onChange={(e) => setBrief(e.target.value)} className="min-h-56 text-[15px] leading-relaxed sm:min-h-64" placeholder="What are we making, for whom, in which language and formats?" aria-label="Brief" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0 flex-1 basis-48 text-[12px] leading-snug text-faint">Model call billed to your Claude plan; cost recorded after the call.</span>
              <Button variant="primary" size="lg" busy={busy} disabled={brief.trim().length < 10} onClick={submit}>
                <Sparkles className="size-4" /> Plan
              </Button>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader eyebrow="History" title="Plans" />
          {!plans.data && plans.loading ? (
            <LoadingRows rows={2} />
          ) : plans.data?.length ? (
            <div className="space-y-2 p-3">
              {plans.data.map((p) => {
                const on = current?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelected(p.id)}
                    aria-pressed={on}
                    aria-current={on ? "true" : undefined}
                    className={cn("nb-press block min-h-11 w-full rounded-ctl border-2 border-ink px-3 py-2.5 text-left", on ? "bg-accent shadow-brut-sm" : "bg-panel shadow-brut-xs hover:bg-white")}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink" dir="auto">
                        {p.plan?.title ?? p.brief.slice(0, 60)}
                      </span>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="mt-1 font-mono text-[12px] text-ink/75">
                      {ago(p.created_at)}
                      {p.cost_usd !== null && ` · ${fmtUsd(p.cost_usd)}`}
                      {p.model && ` · ${p.model}`}
                    </div>
                    {(p.status === "running" || p.status === "queued") && <Progress className="mt-2" indeterminate />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-[13px] text-muted">No plans yet.</div>
          )}
        </Card>
      </div>
      <div className="min-w-0">{current ? <PlanView row={current} /> : <Empty title="No plan selected" icon={<Sparkles className="size-5" />}>Write a brief and press Plan.</Empty>}</div>
    </div>
  );
}

function PlanView({ row }: { row: PlanRow }) {
  if (row.status === "failed") return <ErrorNote>The AI Director failed: {row.error}</ErrorNote>;
  if (!row.plan && row.status === "completed") return <ErrorNote>This plan finished but its saved result could not be read (it does not match the current plan schema). Plan again to get a fresh one.</ErrorNote>;
  if (!row.plan)
    return (
      <Card className="p-5 sm:p-6">
        <div className="font-display text-[18px] font-bold text-ink">Planning…</div>
        <Progress className="mt-4" indeterminate label="The AI Director is planning" />
        <p className="mt-3 text-[13px] leading-relaxed text-muted">The Director runs in the worker and usually takes 1–3 minutes. You can keep working; this page updates when the plan is ready.</p>
      </Card>
    );
  const p = row.plan;
  const total = p.scenes.reduce((s, x) => s + x.durationS, 0);
  return (
    <div className="space-y-6">
      <Card>
        <div className="nb-clapper h-3 rounded-t-[10px] border-b-2 border-ink" aria-hidden />
        <div className="space-y-2 border-b-2 border-ink px-4 py-5 sm:px-6">
          <div className="nb-label text-faint">Call sheet</div>
          <h2 className="font-display text-[26px] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[34px]" dir="auto">
            {p.title}
          </h2>
          <p className="max-w-[70ch] text-[15px] leading-relaxed text-muted" dir="auto">
            {p.logline}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-b-2 border-ink px-4 py-4 sm:px-6 md:grid-cols-4">
          <Meta k="Language" v={p.language} />
          <Meta k="Audience" v={p.audience} />
          <Meta k="Tone" v={p.tone} />
          <Meta k="Scenes" v={`${p.scenes.length} · ${total.toFixed(1)}s`} mono />
        </dl>
        <div className="px-4 py-4 sm:px-6">
          <div className="nb-label mb-2 text-faint">Deliverables</div>
          <div className="flex flex-wrap gap-2">
            {p.deliverables.map((d) => (
              <Pill key={d.name} tone="accent">
                {d.name} · {d.aspect} · {d.durationS}s
              </Pill>
            ))}
          </div>
        </div>
      </Card>
      {(p.questions.length > 0 || p.risks.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {p.questions.length > 0 && (
            <Notice tone="info">
              <div className="mb-1 font-semibold">Questions from the Director</div>
              <ul className="list-disc space-y-1 pl-4" dir="auto">
                {p.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </Notice>
          )}
          {p.risks.length > 0 && (
            <Notice tone="warn">
              <div className="mb-1 font-semibold">Risks & limits</div>
              <ul className="list-disc space-y-1 pl-4" dir="auto">
                {p.risks.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
      )}
      <Card>
        <CardHeader eyebrow="Reading copy" title="Script" sub={p.voiceover.needed ? `Voiceover: ${p.voiceover.language} — ${p.voiceover.direction}` : "No voiceover"} />
        <div className="whitespace-pre-wrap px-4 py-5 text-[15px] leading-[1.8] text-ink sm:px-6 sm:text-[16px] md:max-w-[70ch]" dir="auto">
          {p.script}
        </div>
      </Card>
      <Card>
        <CardHeader eyebrow={`${p.scenes.length} scenes · ${total.toFixed(1)}s`} title="Storyboard & shot list" />
        <ol className="divide-y-2 divide-ink">
          {p.scenes.map((s, i) => {
            const unprod = UNPRODUCIBLE.includes(s.visualSource);
            return (
              <li key={i} className="grid gap-x-4 gap-y-3 px-4 py-4 sm:px-6 md:grid-cols-[64px_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="flex items-center gap-3 md:flex-col md:items-start md:gap-1.5">
                  <span className="inline-flex size-12 items-center justify-center rounded-ctl border-2 border-ink bg-accent font-mono text-[20px] font-bold text-ink shadow-brut-xs">{String(i + 1).padStart(2, "0")}</span>
                  <span className="font-mono text-[13px] font-semibold text-ink">{s.durationS}s</span>
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-[16px] font-bold leading-tight text-ink" dir="auto">
                      {s.title}
                    </span>
                    <Pill tone={unprod ? "warn" : "default"} title={unprod ? "No verified tool can produce this; it will use a marked placeholder" : undefined}>
                      {s.visualSource}
                    </Pill>
                  </div>
                  {s.onScreenText && (
                    <div>
                      <div className="nb-label mb-1 text-faint">On-screen text</div>
                      <div className="inline-block max-w-full break-words rounded-ctl border-2 border-ink bg-accent px-2.5 py-1 text-[14px] font-semibold leading-snug text-ink" dir="auto">
                        {s.onScreenText}
                      </div>
                    </div>
                  )}
                  {s.narration && (
                    <div className="border-s-4 border-ink ps-3 text-[14px] italic leading-relaxed text-ink" dir="auto">
                      “{s.narration}”
                    </div>
                  )}
                </div>
                <div className="min-w-0 space-y-1.5 text-[13px] leading-relaxed text-muted">
                  {s.prompt && <div dir="auto">{s.prompt}</div>}
                  {s.camera && <div className="text-faint">Camera: {s.camera}</div>}
                  {s.constraints.length > 0 && <div className="text-faint">Constraints: {s.constraints.join("; ")}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
      <AcceptPanel row={row} />
    </div>
  );
}

function Meta({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="nb-label text-faint">{k}</dt>
      <dd className={cn("mt-1 break-words text-[14px] font-semibold leading-snug text-ink", mono && "font-mono")} dir="auto">
        {v}
      </dd>
    </div>
  );
}

function AcceptPanel({ row }: { row: PlanRow }) {
  const { data, reload } = useProject();
  const pid = data!.project.id;
  const assets = useApi<AssetFull[]>(`/api/assets?projectId=${pid}`);
  const sys = useApi<{ registry: { tools: { id: string; capabilities: { id: string; ready: boolean }[] }[] } | null; settings: { defaultVoiceId: string | null } }>("/api/system");
  const elevenReady = !!sys.data?.registry?.tools.find((t) => t.id === "elevenlabs")?.capabilities.find((c) => c.id === "elevenlabs.tts")?.ready;
  const images = useMemo(() => (assets.data ?? []).filter((a) => a.kind === "image" || a.kind === "video"), [assets.data]);
  const audio = useMemo(() => (assets.data ?? []).filter((a) => a.kind === "audio"), [assets.data]);
  const [pool, setPool] = useState<string[]>([]);
  const [logo, setLogo] = useState("");
  const [logoRev, setLogoRev] = useState("");
  const [music, setMusic] = useState("");
  const [vo, setVo] = useState<"none" | "elevenlabs" | "asset">("none");
  const [voAsset, setVoAsset] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const [result, setResult] = useState<{ workflowId: string; notes: string[]; issues: { level: string; message: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (sys.data?.settings.defaultVoiceId && !voiceId) setVoiceId(sys.data.settings.defaultVoiceId);
  }, [sys.data, voiceId]);

  const accept = async () => {
    setBusy(true);
    try {
      const r = await api<typeof result>(`/api/plans/${row.id}/accept`, {
        method: "POST",
        json: {
          imagePool: pool,
          logoAssetId: logo || undefined,
          logoReversedAssetId: logoRev || undefined,
          musicAssetId: music || undefined,
          voiceover: vo === "asset" ? { kind: "asset", assetId: voAsset } : vo === "elevenlabs" ? { kind: "elevenlabs", voiceId, languageCode: "ar" } : { kind: "none" },
          whisperLanguage: row.plan?.language.toLowerCase().includes("arab") ? "ar" : "auto",
          palette: data!.project.settings.palette,
          direction: row.plan?.language.toLowerCase().includes("arab") ? "rtl" : "ltr",
        },
      });
      setResult(r);
      void reload();
      toast("Storyboard saved and workflow created", "ok");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  const opts = (list: AssetFull[]) => [{ value: "", label: "— none —" }, ...list.map((a) => ({ value: a.id, label: `${a.label} (${a.kind}${a.width ? ` ${a.width}×${a.height}` : ""})` }))];
  return (
    <Card>
      <CardHeader eyebrow="Final step" title="Accept plan → storyboard + workflow" sub="Orkestr builds the graph deterministically from the plan. Nothing runs until you press Run in the flow editor." />
      <div className="space-y-5 p-4 sm:p-5">
        <div role="group" aria-label={`Visual pool (${pool.length} selected)`}>
          <span className="nb-label mb-1.5 block text-muted">{`Visual pool (${pool.length} selected)`}</span>
          <div className="grid max-h-72 grid-cols-3 gap-2.5 overflow-y-auto rounded-ctl border-2 border-ink bg-panel-2 p-2.5 sm:grid-cols-4 md:grid-cols-6">
            {images.map((a) => {
              const on = pool.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={on}
                  onClick={(e) => {
                    e.preventDefault();
                    setPool(on ? pool.filter((x) => x !== a.id) : [...pool, a.id]);
                  }}
                  className={cn("relative aspect-video overflow-hidden rounded-ctl border-2 bg-panel", on ? "border-ink shadow-brut-accent ring-2 ring-ink" : "border-ink/60 opacity-75 hover:border-ink hover:opacity-100")}
                  title={a.label}
                >
                  {a.kind === "image" ? <img src={assetUrl(a.id)} alt="" className="h-full w-full object-cover" /> : <video src={assetUrl(a.id)} muted className="h-full w-full object-cover" />}
                  {on && <span className="absolute left-1 top-1 inline-flex min-w-6 items-center justify-center rounded-sm border-2 border-ink bg-accent px-1 font-mono text-[12px] font-bold leading-5 text-ink">{pool.indexOf(a.id) + 1}</span>}
                </button>
              );
            })}
            {!images.length && <div className="col-span-full p-3 text-center text-[13px] text-muted">Upload brand visuals in the Assets tab first.</div>}
          </div>
          <span className="mt-1.5 block text-[12px] leading-snug text-faint">Brand photos/videos used for non-UI scenes, in order. UI scenes are captured live from the product URL.</span>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Logo (light bg)">
            <Select value={logo} onChange={(e) => setLogo(e.target.value)} options={opts(images.filter((a) => a.kind === "image"))} />
          </Field>
          <Field label="Logo (dark bg)">
            <Select value={logoRev} onChange={(e) => setLogoRev(e.target.value)} options={opts(images.filter((a) => a.kind === "image"))} />
          </Field>
          <Field label="Music (licensed)">
            <Select value={music} onChange={(e) => setMusic(e.target.value)} options={opts(audio)} />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Voiceover" hint={!elevenReady ? "ElevenLabs is not configured (Settings → Credentials)." : "Paid; you approve before anything is spent."}>
            <Select
              value={vo}
              onChange={(e) => setVo(e.target.value as typeof vo)}
              options={[
                { value: "none", label: "No voiceover" },
                { value: "asset", label: "Use an existing audio take" },
                ...(elevenReady ? [{ value: "elevenlabs", label: "Generate with ElevenLabs (paid)" }] : []),
              ]}
            />
          </Field>
          {vo === "asset" && (
            <Field label="Audio take">
              <Select value={voAsset} onChange={(e) => setVoAsset(e.target.value)} options={opts(audio)} />
            </Field>
          )}
          {vo === "elevenlabs" && (
            <Field label="ElevenLabs voice id">
              <Input className="font-mono text-[13px]" value={voiceId} onChange={(e) => setVoiceId(e.target.value)} />
            </Field>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="primary" size="lg" busy={busy} onClick={accept} disabled={(vo === "asset" && !voAsset) || (vo === "elevenlabs" && !voiceId)}>
            Accept plan
          </Button>
        </div>
        {result && (
          <div className="space-y-2">
            {result.notes.map((n) => (
              <Notice key={n} tone="warn">
                {n}
              </Notice>
            ))}
            {result.issues.filter((i) => i.level === "error").map((i) => (
              <ErrorNote key={i.message}>{i.message}</ErrorNote>
            ))}
            <Link href={`/projects/${data!.project.slug}/flows/${result.workflowId}`}>
              <Button>Open workflow →</Button>
            </Link>
          </div>
        )}
      </div>
    </Card>
  );
}
