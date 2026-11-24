"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Camera, Check, ImageIcon, Mic, Type, Wand2 } from "lucide-react";
import type { WorkspaceView } from "@/server/producer";
import { api, assetUrl, fmtUsd } from "@/lib/api";
import { Button, Notice, Pill, cn, toast } from "@/components/ui";

type Plan = NonNullable<WorkspaceView["plan"]>;
type Scene = Plan["scenes"][number];

const WRITE_ME = "✎ ";

const ROLE_LABEL: Record<string, string> = {
  hook: "Hook",
  problem: "Problem",
  ui: "Product",
  benefit: "Benefit",
  proof: "Proof",
  statement: "Statement",
  cta: "End card",
};

export function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
    "ui-capture": { label: "Your product, captured live", icon: Camera },
    "brand-asset": { label: "Your photo", icon: ImageIcon },
    "motion-graphics": { label: "Motion typography", icon: Type },
  };
  const m = map[source] ?? { label: "Placeholder (no tool can make this)", icon: AlertTriangle };
  return (
    <span className={cn("inline-flex items-center gap-1 text-[12px] font-medium", map[source] ? "text-muted" : "text-warn")}>
      <m.icon className="size-3.5" aria-hidden /> {m.label}
    </span>
  );
}

/** One beat of the story: editable text in place (free — a change only re-renders on produce). */
function BeatCard({ scene, n, productionId, rtl, onSaved }: { scene: Scene; n: number; productionId: string; rtl: boolean; onSaved: () => void }) {
  const missing = scene.onScreenText.startsWith(WRITE_ME);
  const [text, setText] = useState(missing ? "" : scene.onScreenText);
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(missing ? "" : scene.onScreenText), [scene.onScreenText, missing]);
  const save = async () => {
    const value = text.trim();
    if (value === (missing ? "" : scene.onScreenText) || (!value && missing)) return;
    setSaving(true);
    try {
      await api(`/api/productions/${productionId}/refine`, { method: "POST", json: { ops: [{ op: "setSceneText", scene: n, field: "onScreenText", value }] } });
      onSaved();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setSaving(false);
    }
  };
  return (
    <li className={cn("flex gap-3 rounded-card border-2 bg-panel p-3", missing ? "border-warn bg-warn-fill/30" : "border-ink/15")}>
      <div className="flex w-12 shrink-0 flex-col items-center gap-1 pt-0.5">
        <span className="flex size-9 items-center justify-center rounded-ctl border-2 border-ink bg-white font-mono text-[14px] font-bold">{String(n).padStart(2, "0")}</span>
        <span className="font-mono text-[11px] text-muted">{scene.durationS}s</span>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="nb-label text-ink">{ROLE_LABEL[scene.role ?? ""] ?? scene.title}</span>
          <SourceBadge source={scene.visualSource} />
          {saving && <span className="text-[11px] text-faint">saving…</span>}
        </div>
        <label className="sr-only" htmlFor={`beat-${n}`}>
          On-screen text for scene {n}
        </label>
        <textarea
          id={`beat-${n}`}
          dir={rtl ? "rtl" : "auto"}
          rows={Math.min(3, Math.max(1, text.split("\n").length))}
          value={text}
          placeholder={missing ? `Write ${scene.onScreenText.slice(WRITE_ME.length)}` : "No text on screen"}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void save()}
          className="block w-full resize-none rounded-ctl border-2 border-transparent bg-transparent px-1.5 py-1 font-display text-[17px] font-bold leading-snug text-ink outline-none hover:border-ink/15 focus:border-ink focus:bg-white"
        />
        {scene.narration && (
          <p className="border-s-4 border-ink/20 ps-2 text-[13px] italic leading-relaxed text-muted" dir="auto">
            “{scene.narration}”
          </p>
        )}
      </div>
    </li>
  );
}

/** Step 2 of the journey: read the direction, make the essential decisions, press Make it. */
export function DirectionReview({ view, onChanged }: { view: WorkspaceView; onChanged: () => void }) {
  const plan = view.plan!;
  const prod = view.production!;
  const rtl = /arab/i.test(plan.language);
  const [voice, setVoice] = useState<"none" | "asset" | "elevenlabs">(plan.voiceover.needed ? (view.voiceOptions.takes.length ? "asset" : view.voiceOptions.elevenlabs ? "elevenlabs" : "none") : "none");
  const [take, setTake] = useState(view.voiceOptions.takes[0]?.id ?? "");
  const [voiceId, setVoiceId] = useState(view.voiceOptions.defaultVoiceId ?? "");
  const [budget, setBudget] = useState(String(view.costs.budgetUsd || ""));
  const [facts, setFacts] = useState(false);
  const usesWebsite = (!!view.productUrl && plan.scenes.some((s) => s.visualSource === "ui-capture")) || !!view.logoFromWebsite;
  const siteHost = (() => {
    try {
      return new URL(view.website?.url ?? view.productUrl ?? "").host;
    } catch {
      return "This website";
    }
  })();
  const [rights, setRights] = useState(view.websiteRightsConfirmed);
  const [cta, setCta] = useState(plan.cta.text);
  const [busy, setBusy] = useState(false);
  useEffect(() => setCta(plan.cta.text), [plan.cta.text]);
  const missing = plan.scenes.filter((s) => s.onScreenText.startsWith(WRITE_ME)).length;
  const issues = (view.creative?.issues ?? []).filter((i) => !i.id.startsWith("write-"));
  const paid = voice === "elevenlabs";
  const total = plan.deliverables[0]?.durationS ?? 0;

  const make = async () => {
    setBusy(true);
    try {
      if (cta !== plan.cta.text) await api(`/api/productions/${prod.id}/refine`, { method: "POST", json: { ops: [{ op: "setCta", text: cta }] } });
      await api(`/api/productions/${prod.id}/produce`, {
        method: "POST",
        json: {
          confirmFacts: facts,
          ...(usesWebsite ? { confirmWebsiteRights: rights } : {}),
          voice: voice === "asset" ? { kind: "asset", assetId: take } : voice === "elevenlabs" ? { kind: "elevenlabs", voiceId } : { kind: "none" },
          ...(paid ? { budgetUsd: Number(budget) || 0 } : {}),
        },
      });
      toast("Production started — you can keep working while it renders.", "ok");
      onChanged();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-card border-2 border-ink bg-panel">
        <div className="border-b-2 border-ink/10 px-5 py-4">
          <div className="nb-label text-faint">Creative direction · {prod.recipe?.label ?? "Custom"}</div>
          <h2 className="mt-1 font-display text-[24px] font-extrabold leading-tight tracking-[-0.02em] text-ink" dir="auto">
            {plan.title}
          </h2>
          {plan.logline && (
            <p className="mt-1 max-w-[70ch] text-[14px] leading-relaxed text-muted" dir="auto">
              {plan.logline}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {plan.deliverables.map((d) => (
              <Pill key={d.name} tone="default">
                {d.name} · {d.aspect}
                {d.durationS > 1 ? ` · ${d.durationS}s` : ""}
              </Pill>
            ))}
            <Pill tone="default">{plan.language}</Pill>
            <Pill tone="default">{plan.style.motion} motion</Pill>
          </div>
          {plan.source !== "ai" && (
            <p className="mt-3 text-[12px] text-faint">
              {plan.source === "recipe" ? "Drafted by the free recipe planner from your request and website — edit any line below." : plan.source === "qa" ? "Tidied by Orkestr's creative checks (see what changed below)." : plan.source === "edit" ? "Includes your latest change." : null}
            </p>
          )}
        </div>
        <ol className="space-y-2 p-3 sm:p-4" aria-label={`Storyboard, ${plan.scenes.length} scenes, ${total} seconds`}>
          {plan.scenes.map((s, i) => (
            <BeatCard key={`${i}-${s.onScreenText}`} scene={s} n={i + 1} productionId={prod.id} rtl={rtl} onSaved={onChanged} />
          ))}
        </ol>
        <div className="flex flex-wrap items-end gap-3 border-t-2 border-ink/10 px-5 py-4">
          <label className="min-w-0 flex-1 basis-56">
            <span className="nb-label mb-1 block text-muted">Call to action</span>
            <input value={cta} onChange={(e) => setCta(e.target.value)} dir="auto" maxLength={60} className="h-10 w-full rounded-ctl border-2 border-ink bg-white px-3 text-[15px] font-semibold outline-none focus:shadow-brut-accent" />
          </label>
          {plan.cta.url && <span className="pb-2.5 font-mono text-[13px] text-muted">{plan.cta.url}</span>}
        </div>
      </section>

      {plan.questions.length > 0 && (
        <Notice tone="info">
          <div className="mb-1 font-semibold">The director would like to know</div>
          <ul className="list-disc space-y-0.5 ps-4" dir="auto">
            {plan.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          <p className="mt-2 text-[12px]">Answer in “Refine” (e.g. “the brand is Bloom Café, use bloom.cafe”), or edit the lines directly. You can also continue as is.</p>
        </Notice>
      )}
      {(view.creative?.fixes.length || issues.length) && (
        <section className="grid gap-3 md:grid-cols-2">
          {!!view.creative?.fixes.length && (
            <Notice tone="ok">
              <div className="mb-1 font-semibold">Already improved</div>
              <ul className="list-disc space-y-0.5 ps-4">
                {view.creative.fixes.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </Notice>
          )}
          {issues.length > 0 && (
            <Notice tone="warn">
              <div className="mb-1 font-semibold">Worth a look</div>
              <ul className="list-disc space-y-0.5 ps-4">
                {issues.slice(0, 6).map((f) => (
                  <li key={f.id}>{f.message}</li>
                ))}
              </ul>
            </Notice>
          )}
        </section>
      )}
      {plan.risks.length > 0 && (
        <details className="rounded-card border-2 border-ink/15 bg-panel px-4 py-3 text-[13px] text-muted">
          <summary className="cursor-pointer font-semibold text-ink">Limits of this production ({plan.risks.length})</summary>
          <ul className="mt-2 list-disc space-y-1 ps-4" dir="auto">
            {plan.risks.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
      )}

      <section className="rounded-card border-2 border-ink bg-panel p-5" aria-labelledby="decide-h">
        <h3 id="decide-h" className="font-display text-[18px] font-bold text-ink">
          Ready to make it?
        </h3>
        <fieldset className="mt-4">
          <legend className="nb-label mb-2 flex items-center gap-1.5 text-muted">
            <Mic className="size-3.5" aria-hidden /> Voice
          </legend>
          <div className="flex flex-wrap gap-2">
            {[
              { v: "none" as const, label: "No voiceover", sub: "Text on screen only · free" },
              ...(view.voiceOptions.takes.length ? [{ v: "asset" as const, label: "My recording", sub: "Use an uploaded voice take · free" }] : []),
              ...(view.voiceOptions.elevenlabs ? [{ v: "elevenlabs" as const, label: "AI voice (ElevenLabs)", sub: "Paid · you approve the price first" }] : []),
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                aria-pressed={voice === o.v}
                onClick={() => setVoice(o.v)}
                className={cn("nb-press min-w-44 flex-1 rounded-ctl border-2 border-ink px-3 py-2 text-left", voice === o.v ? "bg-accent shadow-brut-xs" : "bg-white hover:bg-panel-2")}
              >
                <span className="block text-[14px] font-semibold">{o.label}</span>
                <span className="block text-[12px] text-muted">{o.sub}</span>
              </button>
            ))}
          </div>
          {voice !== "none" && !plan.voiceover.needed && <p className="mt-2 text-[12px] text-warn">This direction has no narration lines yet — ask for a voiceover in “Refine” so a script is written first.</p>}
          {voice === "asset" && (
            <select value={take} onChange={(e) => setTake(e.target.value)} className="mt-2 h-10 w-full rounded-ctl border-2 border-ink bg-white px-2 text-[14px]">
              {view.voiceOptions.takes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
          {voice === "elevenlabs" && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label>
                <span className="nb-label mb-1 block text-muted">Voice id</span>
                <input value={voiceId} onChange={(e) => setVoiceId(e.target.value)} className="h-10 w-full rounded-ctl border-2 border-ink bg-white px-2 font-mono text-[13px]" />
              </label>
              <label>
                <span className="nb-label mb-1 block text-muted">Spending limit (USD)</span>
                <input value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="0" className="h-10 w-full rounded-ctl border-2 border-ink bg-white px-2 font-mono text-[13px]" />
                <span className="mt-1 block text-[12px] text-muted">Paid steps whose price is known run within this limit; anything above it, or with an unknown price, asks you first. Leave it at 0 to approve every paid step yourself.</span>
              </label>
            </div>
          )}
        </fieldset>
        {voice === "none" && !view.hasMusic && (
          <p className="mt-4 rounded-ctl border-2 border-ink/15 bg-panel-2 px-3 py-2 text-[13px] text-ink">
            <strong>This video will have no sound.</strong> There is no voiceover and no licensed music track in your library — add one (Studio Pro → Assets, or attach it when creating) and refine.
          </p>
        )}
        <div className="mt-5 space-y-2 text-[14px]">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input type="checkbox" checked={facts} onChange={(e) => setFacts(e.target.checked)} className="mt-1 size-4 shrink-0 accent-ink" />
            <span>
              The text above is accurate and I may say it about my product. <span className="text-muted">Orkestr only states what you confirm.</span>
            </span>
          </label>
          {usesWebsite && (
            <label className="flex cursor-pointer items-start gap-2.5">
              <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-1 size-4 shrink-0 accent-ink" />
              <span>
                <span className="font-mono text-[13px]">{siteHost}</span> is mine (or I may use it): Orkestr may show its screens{view.logoFromWebsite ? " and logo" : ""}.
                {view.logoFromWebsite && <img src={assetUrl(view.logoFromWebsite)} alt="Logo found on the website" className="ms-2 inline-block h-6 max-w-24 rounded border border-ink/20 bg-white object-contain align-middle" />}
              </span>
            </label>
          )}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="primary" size="lg" onClick={make} busy={busy} disabled={!facts || missing > 0 || (usesWebsite && !rights && plan.scenes.some((s) => s.visualSource === "ui-capture")) || (voice === "elevenlabs" && !voiceId) || (voice === "asset" && !take)}>
            <Wand2 className="size-4" /> Make it
          </Button>
          <span className="text-[13px] text-muted">
            {missing > 0 ? (
              `${missing} line${missing > 1 ? "s" : ""} still need${missing > 1 ? "" : "s"} your words.`
            ) : paid ? (
              <>Estimated cost: voiceover price unknown until ElevenLabs reports it · everything else runs locally for {fmtUsd(0)}.</>
            ) : (
              <>
                <Check className="me-1 inline size-3.5" aria-hidden />
                Everything runs on this computer · {fmtUsd(0)}. You approve the final cut before export.
              </>
            )}
          </span>
        </div>
      </section>
    </div>
  );
}
