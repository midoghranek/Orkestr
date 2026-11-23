"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { ago, api, assetUrl, fmtUsd, useApi } from "@/lib/api";
import { Button, Card, CardHeader, Empty, ErrorNote, Field, Notice, Pill, Progress, Select, StatusBadge, Textarea, toast, cn } from "@/components/ui";
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

  if (!data) return <div className="p-6 text-xs text-faint">Loading…</div>;
  return (
    <div className="grid gap-4 p-6 xl:grid-cols-[380px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader title="Brief" sub="Describe the goal. The Director plans only with verified tools and the project's verified claims." />
          <div className="space-y-3 p-4">
            <Textarea dir="auto" value={brief} onChange={(e) => setBrief(e.target.value)} className="min-h-48" placeholder="What are we making, for whom, in which language and formats?" />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-faint">Model call billed to your Claude plan; cost recorded after the call.</span>
              <Button variant="primary" busy={busy} disabled={brief.trim().length < 10} onClick={submit}>
                <Sparkles className="size-4" /> Plan
              </Button>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Plans" />
          <div className="divide-y divide-line">
            {plans.data?.length ? (
              plans.data.map((p) => (
                <button key={p.id} onClick={() => setSelected(p.id)} className={cn("block w-full px-4 py-2.5 text-left hover:bg-panel-2/50", current?.id === p.id && "bg-panel-2")}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px]">{p.plan?.title ?? p.brief.slice(0, 60)}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="mt-0.5 text-[11px] text-faint">
                    {ago(p.created_at)}
                    {p.cost_usd !== null && ` · ${fmtUsd(p.cost_usd)}`}
                    {p.model && ` · ${p.model}`}
                  </div>
                  {(p.status === "running" || p.status === "queued") && <Progress className="mt-1.5" indeterminate />}
                </button>
              ))
            ) : (
              <div className="px-4 py-5 text-center text-xs text-muted">No plans yet.</div>
            )}
          </div>
        </Card>
      </div>
      <div>{current ? <PlanView row={current} /> : <Empty title="No plan selected">Write a brief and press Plan.</Empty>}</div>
    </div>
  );
}

function PlanView({ row }: { row: PlanRow }) {
  if (row.status === "failed") return <ErrorNote>The AI Director failed: {row.error}</ErrorNote>;
  if (!row.plan)
    return (
      <Card className="p-6">
        <div className="text-sm">Planning…</div>
        <Progress className="mt-3" indeterminate />
        <div className="mt-2 text-xs text-muted">You can keep working; this page updates when the plan is ready.</div>
      </Card>
    );
  const p = row.plan;
  const total = p.scenes.reduce((s, x) => s + x.durationS, 0);
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={p.title} sub={p.logline} />
        <div className="grid gap-3 p-4 text-xs md:grid-cols-4">
          <Meta k="Language" v={p.language} />
          <Meta k="Audience" v={p.audience} />
          <Meta k="Tone" v={p.tone} />
          <Meta k="Scenes" v={`${p.scenes.length} · ${total.toFixed(1)}s`} />
        </div>
        <div className="flex flex-wrap gap-2 px-4 pb-4">
          {p.deliverables.map((d) => (
            <Pill key={d.name}>
              {d.name} · {d.aspect} · {d.durationS}s
            </Pill>
          ))}
        </div>
      </Card>
      {(p.questions.length > 0 || p.risks.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {p.questions.length > 0 && (
            <Notice tone="info">
              <div className="mb-1 font-semibold">Questions from the Director</div>
              <ul className="list-disc space-y-0.5 pl-4" dir="auto">
                {p.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </Notice>
          )}
          {p.risks.length > 0 && (
            <Notice tone="warn">
              <div className="mb-1 font-semibold">Risks & limits</div>
              <ul className="list-disc space-y-0.5 pl-4" dir="auto">
                {p.risks.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
      )}
      <Card>
        <CardHeader title="Script" sub={p.voiceover.needed ? `Voiceover: ${p.voiceover.language} — ${p.voiceover.direction}` : "No voiceover"} />
        <div className="whitespace-pre-wrap p-4 text-[14px] leading-loose" dir="auto">
          {p.script}
        </div>
      </Card>
      <Card>
        <CardHeader title="Storyboard & shot list" />
        <div className="divide-y divide-line">
          {p.scenes.map((s, i) => (
            <div key={i} className="grid gap-2 px-4 py-3 md:grid-cols-[48px_1fr_1fr]">
              <div className="text-xs text-faint">
                #{i + 1}
                <div>{s.durationS}s</div>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium">{s.title}</span>
                  <Pill tone={UNPRODUCIBLE.includes(s.visualSource) ? "warn" : "default"} title={UNPRODUCIBLE.includes(s.visualSource) ? "No verified tool can produce this; it will use a marked placeholder" : undefined}>
                    {s.visualSource}
                  </Pill>
                </div>
                {s.onScreenText && (
                  <div className="mt-1 text-xs text-accent" dir="auto">
                    {s.onScreenText}
                  </div>
                )}
                {s.narration && (
                  <div className="mt-1 text-xs text-fg/90" dir="auto">
                    “{s.narration}”
                  </div>
                )}
              </div>
              <div className="text-[11px] leading-relaxed text-muted">
                {s.prompt && <div>{s.prompt}</div>}
                {s.camera && <div className="mt-1 text-faint">Camera: {s.camera}</div>}
                {s.constraints.length > 0 && <div className="mt-1 text-faint">Constraints: {s.constraints.join("; ")}</div>}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <AcceptPanel row={row} />
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-faint">{k}</div>
      <div className="mt-0.5 text-muted" dir="auto">
        {v}
      </div>
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
      <CardHeader title="Accept plan → storyboard + workflow" sub="Orkestr builds the graph deterministically from the plan. Nothing runs until you press Run in the flow editor." />
      <div className="space-y-4 p-4">
        <Field label={`Visual pool (${pool.length} selected)`} hint="Brand photos/videos used for non-UI scenes, in order. UI scenes are captured live from the product URL.">
          <div className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto rounded border border-line p-2 md:grid-cols-6">
            {images.map((a) => {
              const on = pool.includes(a.id);
              return (
                <button key={a.id} onClick={() => setPool(on ? pool.filter((x) => x !== a.id) : [...pool, a.id])} className={cn("relative aspect-video overflow-hidden rounded border", on ? "border-accent ring-1 ring-accent" : "border-line opacity-70 hover:opacity-100")} title={a.label}>
                  {a.kind === "image" ? <img src={assetUrl(a.id)} alt="" className="h-full w-full object-cover" /> : <video src={assetUrl(a.id)} muted className="h-full w-full object-cover" />}
                  {on && <span className="absolute left-1 top-1 rounded bg-accent px-1 text-[10px] font-bold text-accent-fg">{pool.indexOf(a.id) + 1}</span>}
                </button>
              );
            })}
            {!images.length && <div className="col-span-full p-3 text-center text-xs text-muted">Upload brand visuals in the Assets tab first.</div>}
          </div>
        </Field>
        <div className="grid gap-3 md:grid-cols-3">
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
        <div className="grid gap-3 md:grid-cols-3">
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
              <input className="h-8 w-full rounded-md border border-line bg-bg px-2.5 text-[13px]" value={voiceId} onChange={(e) => setVoiceId(e.target.value)} />
            </Field>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="primary" busy={busy} onClick={accept} disabled={(vo === "asset" && !voAsset) || (vo === "elevenlabs" && !voiceId)}>
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
