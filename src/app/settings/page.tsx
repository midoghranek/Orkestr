"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Check, X } from "lucide-react";
import type { Registry, RegistryEntry } from "@/server/adapters/registry";
import type { Settings } from "@/server/settings";
import { Button, Card, CardHeader, Empty, ErrorNote, Field, Input, LoadingRows, Notice, PageHeader, Pill, Spinner, StatusBadge, Textarea, cn, toast } from "@/components/ui";
import { ago, api, useApi } from "@/lib/api";

interface SystemData {
  registry: Registry | null;
  settings: Settings;
  credentials: { provider: string; hint: string; updatedAt: number; source: "store" | "env" }[];
  worker: { alive: boolean } & Record<string, unknown>;
  whisperModels: string[];
}

const PROVIDER_INFO: { id: string; name: string; note: string }[] = [
  { id: "elevenlabs", name: "ElevenLabs", note: "Used today by the ElevenLabs adapter (voiceover / TTS). Paid per character." },
  { id: "fal", name: "fal.ai", note: "Stored for a future adapter. No adapter uses it yet." },
  { id: "runway", name: "Runway", note: "Stored for a future adapter. No adapter uses it yet." },
  { id: "higgsfield", name: "Higgsfield", note: "Stored for a future adapter. No adapter uses it yet." },
];

const WHISPER: { id: string; size: string; note: string }[] = [
  { id: "tiny", size: "~75 MB", note: "fastest, lowest accuracy" },
  { id: "base", size: "~142 MB", note: "fast, fair accuracy" },
  { id: "small", size: "~466 MB", note: "recommended for Egyptian Arabic" },
  { id: "medium", size: "~1.5 GB", note: "recommended for Egyptian Arabic, best accuracy" },
];

export default function SettingsPage() {
  const { data, error, loading, reload } = useApi<SystemData>("/api/system");
  const [discovering, setDiscovering] = useState(false);

  async function discover() {
    setDiscovering(true);
    try {
      const r = await api<{ queued: boolean }>("/api/system/discover", { method: "POST", json: {} });
      if (r.queued) {
        toast("Discovery queued in worker", "info");
        setTimeout(() => {
          void reload();
          setDiscovering(false);
        }, 4000);
        return;
      }
      toast("Discovery finished", "ok");
      await reload();
    } catch (e) {
      toast((e as Error).message, "err");
    }
    setDiscovering(false);
  }

  return (
    <div className="mx-auto max-w-5xl pb-12">
      <PageHeader eyebrow="Studio configuration" title="Settings" sub="Tools, models, credentials and budgets. Everything is stored locally." actions={loading ? <Spinner /> : undefined} />
      <div className="space-y-6 px-4 sm:px-6 lg:px-8">
        <ErrorNote>{error}</ErrorNote>
        {loading && !data && !error && (
          <Card>
            <LoadingRows rows={4} />
          </Card>
        )}
        {data && (
          <>
            <ToolsSection registry={data.registry} discovering={discovering} onDiscover={discover} />
            <WhisperSection installed={data.whisperModels} />
            <CredentialsSection creds={data.credentials} onChange={reload} />
            <BudgetSection settings={data.settings} onSaved={reload} />
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- Tools ---------------- */

function ToolsSection({ registry, discovering, onDiscover }: { registry: Registry | null; discovering: boolean; onDiscover: () => void }) {
  return (
    <Card>
      <CardHeader
        eyebrow="01 · Tools"
        title="Tools & capabilities"
        sub={registry ? `Discovered ${ago(registry.generatedAt)}. Only verified capabilities are listed.` : "No discovery report yet."}
        actions={
          <Button size="sm" variant="primary" busy={discovering} onClick={onDiscover}>
            {registry ? "Re-run discovery" : "Run discovery"}
          </Button>
        }
      />
      <div className="space-y-5 p-4">
        {!registry ? (
          <Empty title="Nothing discovered yet" action={<Button variant="primary" busy={discovering} onClick={onDiscover}>Run discovery</Button>}>
            Discovery checks which local tools and APIs are actually installed and healthy. It never spends credits.
          </Empty>
        ) : (
          <>
            <EnvGrid env={registry.environment} />
            <ul className="space-y-2">
              {registry.tools.map((t) => (
                <ToolRow key={t.id} tool={t} />
              ))}
            </ul>
            {registry.unavailable.length > 0 && (
              <div>
                <div className="nb-label mb-2 text-faint">Optional tools without an adapter</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {registry.unavailable.map((u) => (
                    <div key={u.id} className="rounded-card border-2 border-ink bg-panel px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[14px] font-semibold text-ink">{u.name}</span>
                        <Pill tone={u.status === "present-no-adapter" ? "warn" : "default"}>{u.status}</Pill>
                      </div>
                      <div className="mt-1 text-[13px] text-muted">{u.reason}</div>
                      <div className="mt-1 text-[12px] text-faint">Would enable: {u.enables}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function EnvGrid({ env }: { env: Record<string, unknown> }) {
  const keys: [string, string][] = [
    ["os", "OS"],
    ["node", "Node"],
    ["gpu", "GPU"],
    ["freeDiskGb", "Free disk"],
    ["cpus", "CPUs"],
    ["memoryGb", "Memory"],
  ];
  const fmt = (k: string, v: unknown) => (k === "freeDiskGb" || k === "memoryGb" ? `${String(v)} GB` : String(v));
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {keys.map(([k, label]) => (
        <div key={k} className="rounded-card border-2 border-ink bg-panel px-3 py-2">
          <div className="nb-label text-faint">{label}</div>
          <div className="mt-0.5 break-words font-mono text-[13px] text-ink">{env[k] === undefined ? "none detected" : fmt(k, env[k])}</div>
        </div>
      ))}
    </div>
  );
}

function ToolRow({ tool }: { tool: RegistryEntry }) {
  const [open, setOpen] = useState(false);
  const ready = tool.capabilities.filter((c) => c.ready).length;
  const Chev = open ? ChevronDown : ChevronRight;
  const panelId = `tool-${tool.id}`;
  return (
    <li className="rounded-card border-2 border-ink bg-panel">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-12 w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-card px-3 py-2 text-left transition-colors hover:bg-panel-2"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${open ? "Hide" : "Show"} capabilities of ${tool.name}`}
      >
        <Chev className="size-5 shrink-0 text-ink" aria-hidden />
        <span className="text-[14px] font-semibold text-ink">{tool.name}</span>
        {tool.discovery.version && <span className="font-mono text-[12px] text-faint">v{tool.discovery.version}</span>}
        <StatusBadge status={tool.health.status} />
        <Pill>{tool.kind}</Pill>
        <span className="font-mono text-[12px] text-muted sm:ml-auto">
          {ready}/{tool.capabilities.length} ready
        </span>
        <span className="w-full min-w-0 basis-full break-words pl-7 text-[13px] leading-snug text-muted [overflow-wrap:anywhere]">{tool.health.message}</span>
      </button>
      {open && (
        <div id={panelId} className="space-y-2 border-t-2 border-line px-3 py-3">
          {tool.discovery.path && <div className="break-all font-mono text-[12px] text-faint">{tool.discovery.path}</div>}
          <ul className="divide-y-2 divide-line rounded-ctl border-2 border-line bg-white/50">
            {tool.capabilities.map((c) => (
              <li key={c.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-ink", c.ready ? "bg-ok-fill" : "bg-err-fill")}
                    role="img"
                    aria-label={c.ready ? "ready" : "not ready"}
                  >
                    {c.ready ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
                  </span>
                  <span className="text-[14px] font-semibold text-ink">{c.label}</span>
                  <span className="font-mono text-[12px] text-faint">{c.id}</span>
                  {c.paid && <Pill tone="paid">paid</Pill>}
                </div>
                <div className="mt-1 text-[13px] text-muted">{c.description}</div>
                {!c.ready && c.blockedReason && (
                  <div className="mt-1 text-[13px] font-medium text-warn">Blocked: {c.blockedReason}</div>
                )}
                <div className="mt-1 text-[13px] text-muted">
                  Cost:{" "}
                  <span className="font-mono">
                    {c.cost.model === "free" ? "free" : c.cost.model === "per_unit" ? `$${c.cost.usdPerUnit} per ${c.cost.unit} (${c.cost.source}, as of ${c.cost.asOf})` : "unknown"}
                  </span>
                  {c.cost.note ? ` — ${c.cost.note}` : ""}
                </div>
                {c.limitations && c.limitations.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-[12px] text-muted">
                    {c.limitations.map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-1 text-[12px] text-faint">Verified by: {c.verifiedBy}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/* ---------------- Whisper ---------------- */

function WhisperSection({ installed }: { installed: string[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function install(model: string) {
    setBusy(model);
    try {
      await api("/api/system/install-whisper", { method: "POST", json: { model } });
      toast(`Downloading whisper ${model} in the background. Re-run discovery when it finishes.`, "info");
    } catch (e) {
      toast((e as Error).message, "err");
    }
    setBusy(null);
  }
  const has = (id: string) => installed.some((m) => m === id || m.includes(id));
  return (
    <Card>
      <CardHeader eyebrow="02 · Transcription" title="Whisper models" sub="Local transcription. Downloads are free from Hugging Face; progress appears in the live log on the Queue page." />
      <div className="space-y-3 p-4">
        <Notice>For Egyptian Arabic, use small or medium. tiny and base are noticeably less accurate on dialect speech.</Notice>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {WHISPER.map((m) => (
            <div key={m.id} className="flex flex-col gap-2 rounded-card border-2 border-ink bg-panel px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[14px] font-semibold text-ink">{m.id}</span>
                {has(m.id) ? (
                  <Pill tone="ok">
                    <Check className="size-3" aria-hidden />
                    installed
                  </Pill>
                ) : (
                  <span className="font-mono text-[12px] text-faint">{m.size}</span>
                )}
              </div>
              <div className="flex-1 text-[13px] text-muted">{m.note}</div>
              <Button size="sm" busy={busy === m.id} onClick={() => install(m.id)}>
                {has(m.id) ? "Re-download" : `Download ${m.size}`}
              </Button>
            </div>
          ))}
        </div>
        <div className="break-words font-mono text-[12px] text-faint">Installed: {installed.length ? installed.join(", ") : "none"}</div>
      </div>
    </Card>
  );
}

/* ---------------- Credentials ---------------- */

function CredentialsSection({ creds, onChange }: { creds: SystemData["credentials"]; onChange: () => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(p: string) {
    setBusy(p);
    try {
      await api(`/api/credentials/${p}`, { method: "PUT", json: { secret: drafts[p]?.trim() } });
      setDrafts((d) => ({ ...d, [p]: "" }));
      setSaved(true);
      toast(`${p} key saved`, "ok");
      await onChange();
    } catch (e) {
      toast((e as Error).message, "err");
    }
    setBusy(null);
  }
  async function remove(p: string) {
    setBusy(p);
    try {
      await api(`/api/credentials/${p}`, { method: "DELETE" });
      toast(`${p} key removed`, "ok");
      setSaved(true);
      await onChange();
    } catch (e) {
      toast((e as Error).message, "err");
    }
    setBusy(null);
  }

  return (
    <Card>
      <CardHeader eyebrow="03 · Credentials" title="Credentials" sub="Encrypted locally (AES-256-GCM). Only a masked hint is ever shown back." />
      <div className="space-y-3 p-4">
        <Notice tone="warn">Only ElevenLabs has an adapter today. The other keys are stored for future adapters and are not used by anything yet.</Notice>
        {saved && <Notice tone="ok">Credentials changed. Re-run discovery (Tools section) so capabilities pick them up.</Notice>}
        {PROVIDER_INFO.map((p) => {
          const c = creds.find((x) => x.provider === p.id);
          return (
            <div key={p.id} className="rounded-card border-2 border-ink bg-panel px-3 py-3 sm:px-4">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[14px] font-semibold text-ink">{p.name}</span>
                {c ? <Pill tone="ok">configured</Pill> : <Pill>not set</Pill>}
                {c && (
                  <span className="font-mono text-[12px] text-muted">
                    {c.hint} · {c.source === "env" ? "from environment variable" : `saved ${ago(c.updatedAt)}`}
                  </span>
                )}
              </div>
              <div className="mt-1 text-[12px] text-faint">{p.note}</div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  type="password"
                  autoComplete="off"
                  aria-label={`${p.name} API key`}
                  placeholder={c ? "Paste a new key to replace" : "Paste API key"}
                  value={drafts[p.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                  className="w-full font-mono sm:min-w-56 sm:flex-1"
                />
                <div className="flex gap-2">
                  <Button variant="primary" busy={busy === p.id} disabled={(drafts[p.id] ?? "").trim().length < 8} onClick={() => save(p.id)}>
                    Save
                  </Button>
                  {c && c.source === "store" && (
                    <Button variant="danger" busy={busy === p.id} onClick={() => remove(p.id)}>
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------------- Budgets ---------------- */

function BudgetSection({ settings, onSaved }: { settings: Settings; onSaved: () => Promise<void> }) {
  const toForm = (s: Settings) => ({
    concurrency: String(s.concurrency),
    autoApproveUnderUsd: String(s.autoApproveUnderUsd),
    directorModel: s.directorModel,
    directorMaxUsd: String(s.directorMaxUsd),
    importRoots: s.importRoots.join("\n"),
    elevenlabsUsdPerChar: s.elevenlabsUsdPerChar === null ? "" : String(s.elevenlabsUsdPerChar),
    defaultVoiceId: s.defaultVoiceId ?? "",
  });
  const [f, setF] = useState(toForm(settings));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const sig = JSON.stringify(settings);
  useEffect(() => setF(toForm(JSON.parse(sig) as Settings)), [sig]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setErr(null);
    const patch: Record<string, unknown> = {};
    const num = (k: keyof Settings, v: string) => {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`${k} must be a number`);
      if (n !== settings[k]) patch[k] = n;
    };
    try {
      num("concurrency", f.concurrency);
      num("autoApproveUnderUsd", f.autoApproveUnderUsd);
      num("directorMaxUsd", f.directorMaxUsd);
      if (f.directorModel.trim() !== settings.directorModel) patch.directorModel = f.directorModel.trim();
      const roots = f.importRoots.split("\n").map((l) => l.trim()).filter(Boolean);
      if (JSON.stringify(roots) !== JSON.stringify(settings.importRoots)) patch.importRoots = roots;
      const perChar = f.elevenlabsUsdPerChar.trim() === "" ? null : Number(f.elevenlabsUsdPerChar);
      if (perChar !== null && !Number.isFinite(perChar)) throw new Error("elevenlabsUsdPerChar must be a number");
      if (perChar !== settings.elevenlabsUsdPerChar) patch.elevenlabsUsdPerChar = perChar;
      const voice = f.defaultVoiceId.trim() === "" ? null : f.defaultVoiceId.trim();
      if (voice !== settings.defaultVoiceId) patch.defaultVoiceId = voice;
    } catch (e) {
      setErr((e as Error).message);
      return;
    }
    if (!Object.keys(patch).length) {
      toast("No changes to save", "info");
      return;
    }
    setBusy(true);
    try {
      await api("/api/settings", { method: "PUT", json: patch });
      toast("Settings saved", "ok");
      await onSaved();
    } catch (e) {
      setErr((e as Error).message);
      toast((e as Error).message, "err");
    }
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader eyebrow="04 · Budgets" title="Budgets & defaults" actions={<Button size="sm" variant="primary" busy={busy} onClick={save}>Save changes</Button>} />
      <div className="space-y-4 p-4">
        <Notice>
          Auto-approve limit 0 means every paid step needs explicit approval. Steps whose price is unknown always need approval, regardless of this limit.
        </Notice>
        <ErrorNote>{err}</ErrorNote>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Concurrency" hint="Max node jobs running at once (1-8)">
            <Input type="number" min={1} max={8} step={1} value={f.concurrency} onChange={set("concurrency")} />
          </Field>
          <Field label="Auto-approve under (USD)" hint="Paid steps below this need no click (0-100)">
            <Input type="number" min={0} max={100} step={0.05} value={f.autoApproveUnderUsd} onChange={set("autoApproveUnderUsd")} />
          </Field>
          <Field label="Director model" hint="Model for the AI Director">
            <Input value={f.directorModel} onChange={set("directorModel")} />
          </Field>
          <Field label="Director max (USD)" hint="Per-plan cap for the Director call (0.05-20)">
            <Input type="number" min={0.05} max={20} step={0.05} value={f.directorMaxUsd} onChange={set("directorMaxUsd")} />
          </Field>
          <Field label="ElevenLabs USD / character" hint="Optional, estimates only. Blank = unknown price">
            <Input type="number" min={0} max={1} step={0.00001} value={f.elevenlabsUsdPerChar} onChange={set("elevenlabsUsdPerChar")} placeholder="unknown" />
          </Field>
          <Field label="Default voice ID" hint="Optional ElevenLabs voice id">
            <Input value={f.defaultVoiceId} onChange={set("defaultVoiceId")} placeholder="none" />
          </Field>
        </div>
        <Field label="Import folders" hint="One absolute path per line. Orkestr may read media from these folders only (read-only).">
          <Textarea value={f.importRoots} onChange={set("importRoots")} placeholder={"C:\\Users\\you\\Videos"} className="font-mono text-[13px]" />
        </Field>
      </div>
    </Card>
  );
}
