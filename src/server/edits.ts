import type { DirectorPlan, EditOp } from "@/shared/schema";
import { DirectorPlanSchema, EditOpsSchema } from "@/shared/schema";

/**
 * Conversational editing. A request ("slow it down", "change the CTA to Book a table", "make an Instagram
 * version") becomes a list of validated EditOps; `applyEdits` applies them to a plan as a pure function.
 * The plan → graph step stays deterministic, and the engine's signatures make unchanged work (captures,
 * voiceover, captions) reuse cached outputs, so only what changed re-renders.
 */

const r1 = (n: number) => Math.round(n * 10) / 10;

export class EditError extends Error {}

export function applyEdits(plan: DirectorPlan, ops: EditOp[]): { plan: DirectorPlan; changes: string[] } {
  const p: DirectorPlan = structuredClone(plan);
  const changes: string[] = [];
  const sceneAt = (n: number) => {
    const s = p.scenes[n - 1];
    if (!s) throw new EditError(`There is no scene ${n} (the plan has ${p.scenes.length}).`);
    return s;
  };
  const rebalance = (except: number, delta: number) => {
    // Keep the total length: take/give time proportionally from the other scenes (not the end card).
    const others = p.scenes.map((s, i) => ({ s, i })).filter(({ i }) => i !== except && i !== p.scenes.length - 1);
    const pool = others.reduce((a, { s }) => a + s.durationS, 0);
    if (!pool) return;
    for (const { s } of others) s.durationS = r1(Math.max(1, s.durationS - (delta * s.durationS) / pool));
  };
  for (const op of ops) {
    switch (op.op) {
      case "setSceneText": {
        const s = sceneAt(op.scene);
        s[op.field] = op.value;
        changes.push(`Scene ${op.scene}: new ${op.field === "onScreenText" ? "text" : op.field}.`);
        break;
      }
      case "retime": {
        const s = sceneAt(op.scene);
        const delta = r1(op.durationS - s.durationS);
        s.durationS = op.durationS;
        rebalance(op.scene - 1, delta);
        changes.push(`Scene ${op.scene} now lasts ${op.durationS} s.`);
        break;
      }
      case "setTotalDuration": {
        const d = p.deliverables[op.deliverable - 1];
        if (!d) throw new EditError(`There is no deliverable ${op.deliverable}.`);
        if (op.deliverable === 1) {
          const k = op.durationS / d.durationS;
          p.scenes.forEach((s) => (s.durationS = r1(Math.max(1, s.durationS * k))));
          const sum = p.scenes.reduce((a, s) => a + s.durationS, 0);
          p.scenes[p.scenes.length - 1].durationS = r1(p.scenes[p.scenes.length - 1].durationS + op.durationS - sum);
        }
        d.durationS = op.durationS;
        changes.push(`${d.name} is now ${op.durationS} s.`);
        break;
      }
      case "reorderScenes": {
        const n = p.scenes.length;
        const order = op.order;
        if (order.length !== n || new Set(order).size !== n || order.some((x) => x < 1 || x > n)) throw new EditError("The new scene order must list every scene once.");
        p.scenes = order.map((i) => p.scenes[i - 1]);
        changes.push(`Scenes reordered: ${order.join(", ")}.`);
        break;
      }
      case "removeScene": {
        if (p.scenes.length <= 1) throw new EditError("A video needs at least one scene.");
        const [gone] = p.scenes.splice(op.scene - 1, 1);
        if (!gone) throw new EditError(`There is no scene ${op.scene}.`);
        // Give its time to the remaining scenes so the length stays the same.
        const pool = p.scenes.reduce((a, s) => a + s.durationS, 0);
        p.scenes.forEach((s) => (s.durationS = r1(s.durationS + (gone.durationS * s.durationS) / pool)));
        changes.push(`Removed scene ${op.scene} ("${gone.onScreenText || gone.title}").`);
        break;
      }
      case "addScene": {
        p.scenes.splice(op.after, 0, op.scene);
        rebalance(op.after, op.scene.durationS);
        changes.push(`Added a scene after scene ${op.after}.`);
        break;
      }
      case "setLayout": {
        const s = sceneAt(op.scene);
        s.visualSource = op.visualSource;
        if (op.role) s.role = op.role;
        changes.push(`Scene ${op.scene} now uses ${op.visualSource.replace("-", " ")}.`);
        break;
      }
      case "setCta": {
        if (op.text !== undefined) p.cta.text = op.text;
        if (op.url !== undefined) p.cta.url = op.url;
        changes.push(`Call to action: "${p.cta.text}"${p.cta.url ? ` · ${p.cta.url}` : ""}.`);
        break;
      }
      case "setStyle": {
        if (op.motion) p.style.motion = op.motion;
        if (op.textScale !== undefined) p.style.textScale = op.textScale;
        if (op.captions !== undefined) p.style.captions = op.captions;
        changes.push(`Style: ${[op.motion && `${op.motion} motion`, op.textScale !== undefined && `text ×${op.textScale}`, op.captions !== undefined && (op.captions ? "captions on" : "captions off")].filter(Boolean).join(", ")}.`);
        break;
      }
      case "setTone": {
        p.tone = op.tone;
        changes.push(`Tone: ${op.tone}.`);
        break;
      }
      case "addDeliverable": {
        if (p.deliverables.length >= 8) throw new EditError("At most 8 deliverables.");
        p.deliverables.push({ name: op.name, aspect: op.aspect, durationS: op.durationS });
        changes.push(`New version: ${op.name} (${op.aspect}, ${op.durationS} s).`);
        break;
      }
      case "removeDeliverable": {
        const i = p.deliverables.findIndex((d) => d.name.toLowerCase() === op.name.toLowerCase());
        if (i < 0) throw new EditError(`No deliverable named "${op.name}".`);
        if (p.deliverables.length === 1) throw new EditError("Keep at least one deliverable.");
        if (i === 0) throw new EditError("The main deliverable can't be removed; change its length or format instead.");
        p.deliverables.splice(i, 1);
        changes.push(`Removed ${op.name}.`);
        break;
      }
      case "setVoiceover": {
        p.voiceover.needed = op.needed;
        if (op.direction !== undefined) p.voiceover.direction = op.direction;
        changes.push(op.needed ? "Voiceover on." : "Voiceover off.");
        break;
      }
    }
  }
  return { plan: DirectorPlanSchema.parse(p), changes };
}

/* --------------------------- Deterministic instruction parser --------------------------- */

const quoted = (s: string) => s.match(/["“”«»'‘’]([^"“”«»'‘’]{1,120})["“”«»'‘’]/)?.[1]?.trim();
const sceneNum = (s: string): number | undefined => {
  const words: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, last: -1, opening: 1, final: -1 };
  const m = s.match(/scene\s*(\d{1,2})/i) ?? s.match(/(\d{1,2})(?:st|nd|rd|th)\s+scene/i);
  if (m) return Number(m[1]);
  const w = s.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|last|opening|final)\s+scene/i);
  return w ? words[w[1].toLowerCase()] : undefined;
};

/**
 * Translate common requests into ops without a model call (free, instant, predictable). Returns null when the
 * request needs creative rewriting (new copy, translation, a different concept) — then the AI path is offered.
 */
export function parseInstruction(text: string, plan: DirectorPlan): { ops: EditOp[]; summary: string } | null {
  const t = text.toLowerCase().trim();
  const ops: EditOp[] = [];
  const n = plan.scenes.length;
  const fixN = (x: number | undefined) => (x === -1 ? n : x);
  const say: string[] = [];

  // Length / format versions.
  const secs = t.match(/(\d{1,3})\s*(?:-|\s)?\s*(?:s\b|sec|second)/)?.[1];
  const platform = /instagram|reel|tiktok|story|stories|shorts|vertical/.test(t) ? "9:16" : /square|feed/.test(t) ? "1:1" : /youtube|landscape|widescreen/.test(t) ? "16:9" : undefined;
  if (/(version|cut|copy|variant|edit)\b/.test(t) && (platform || /shorter|longer/.test(t)) && /(make|create|add|another|also|new|give)/.test(t)) {
    const aspect = platform ?? plan.deliverables[0].aspect;
    const dur = secs ? Number(secs) : /shorter/.test(t) ? Math.max(6, Math.round(plan.deliverables[0].durationS / 2)) : plan.deliverables[0].durationS;
    const name = `${/instagram|reel/.test(t) ? "Instagram" : /tiktok/.test(t) ? "TikTok" : /story|stories/.test(t) ? "Story" : aspect === "1:1" ? "Square" : "Short"} cut ${dur}s`;
    ops.push({ op: "addDeliverable", name, aspect, durationS: dur });
    say.push(`add a ${aspect} ${dur}-second version`);
  } else if (secs && /(make it|shorten|cut it|trim|length|long|shorter|longer)/.test(t)) {
    ops.push({ op: "setTotalDuration", deliverable: 1, durationS: Number(secs) });
    say.push(`make it ${secs} s`);
  } else if (/\bshorter\b|tighten|too long/.test(t) && !sceneNum(t)) {
    ops.push({ op: "setTotalDuration", deliverable: 1, durationS: Math.max(5, Math.round(plan.deliverables[0].durationS * 0.75)) });
    say.push("make it shorter");
  }

  // Motion / pacing.
  if (/slow(er)? (it )?down|slower|calmer|less (fast|busy|hectic)|more relaxed|more cinematic|cinematic|elegant|premium|luxur/.test(t)) {
    ops.push({ op: "setStyle", motion: "calm" });
    say.push("use calmer, more cinematic motion");
  } else if (/faster|speed (it )?up|more energ|punchier|more exciting|dynamic|snappier/.test(t) && !/first (three|3|two|2) seconds|opening|hook|intro/.test(t)) {
    ops.push({ op: "setStyle", motion: "energetic" });
    say.push("use more energetic motion");
  }
  if (/(first (three|3|two|2) seconds|opening|hook|intro).*(exciting|punch|stronger|faster|grab|better)|more exciting (start|opening)/.test(t)) {
    if (plan.scenes[0].durationS > 2) ops.push({ op: "retime", scene: 1, durationS: 1.8 });
    ops.push({ op: "setStyle", motion: "energetic" });
    say.push("make the opening faster and punchier");
  }
  if (/(text|words|font|type).*(bigger|larger|easier to read|more readable|readable)|easier to read|bigger text|larger text/.test(t)) {
    ops.push({ op: "setStyle", textScale: Math.min(1.6, r1((plan.style?.textScale ?? 1) + 0.2)) });
    say.push("make the text bigger");
  } else if (/(text|words|font).*(smaller|less big)|smaller text/.test(t)) {
    ops.push({ op: "setStyle", textScale: Math.max(0.7, r1((plan.style?.textScale ?? 1) - 0.15)) });
    say.push("make the text smaller");
  }
  if (/(no|remove|hide|turn off|without) (the )?(captions|subtitles)/.test(t)) {
    ops.push({ op: "setStyle", captions: false });
    say.push("turn captions off");
  } else if (/(add|show|turn on) (the )?(captions|subtitles)/.test(t)) {
    ops.push({ op: "setStyle", captions: true });
    say.push("turn captions on");
  }

  // CTA.
  const cta = t.match(/(?:call to action|cta|button)[^"“«']*(?:to|:|=|say|says|read)\s*["“«']?([^"”»']{2,60})["”»']?\s*$/i);
  if (cta || (/(call to action|cta)/.test(t) && quoted(text))) {
    const value = quoted(text) ?? text.slice(text.toLowerCase().lastIndexOf(cta![1].toLowerCase().trim())).trim();
    ops.push({ op: "setCta", text: value.replace(/[.!]$/, "").slice(0, 60) });
    say.push(`change the call to action to "${value}"`);
  }
  const url = text.match(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/\S*)?/i)?.[0];
  if (url && /(url|link|website|site)/.test(t) && /(change|set|use|put)/.test(t)) ops.push({ op: "setCta", url: url.replace(/^https?:\/\//, "") });

  // Scene-level text, removal, retime, swap.
  const sn = fixN(sceneNum(t));
  if (sn && /(remove|delete|drop|cut)\b/.test(t)) {
    ops.push({ op: "removeScene", scene: sn });
    say.push(`remove scene ${sn}`);
  } else if (sn && quoted(text) && /(text|say|headline|line|change|replace|read)/.test(t)) {
    ops.push({ op: "setSceneText", scene: sn, field: /narrat|voice/.test(t) ? "narration" : "onScreenText", value: quoted(text)! });
    say.push(`change the text of scene ${sn}`);
  } else if (sn && /(longer|more time|slow)/.test(t)) {
    ops.push({ op: "retime", scene: sn, durationS: Math.min(60, r1(plan.scenes[sn - 1]?.durationS * 1.4 || 3)) });
    say.push(`give scene ${sn} more time`);
  } else if (sn && /(shorter|less time|quicker)/.test(t)) {
    ops.push({ op: "retime", scene: sn, durationS: Math.max(1, r1(plan.scenes[sn - 1]?.durationS * 0.7 || 2)) });
    say.push(`give scene ${sn} less time`);
  } else if (sn && /(show|use).*(product|screen|ui|website)/.test(t)) {
    ops.push({ op: "setLayout", scene: sn, visualSource: "ui-capture", role: "ui" });
    say.push(`show your product in scene ${sn}`);
  } else if (sn && /(photo|picture|image)/.test(t)) {
    ops.push({ op: "setLayout", scene: sn, visualSource: "brand-asset" });
    say.push(`use one of your photos in scene ${sn}`);
  }
  const swap = t.match(/swap scenes? (\d{1,2}) (?:and|with) (\d{1,2})/);
  if (swap) {
    const a = Number(swap[1]);
    const c = Number(swap[2]);
    const order = plan.scenes.map((_, i) => i + 1);
    if (a <= n && c <= n) {
      [order[a - 1], order[c - 1]] = [order[c - 1], order[a - 1]];
      ops.push({ op: "reorderScenes", order });
      say.push(`swap scenes ${a} and ${c}`);
    }
  }
  if (/(no|remove|without|turn off) (the )?(voice ?over|narration)/.test(t)) ops.push({ op: "setVoiceover", needed: false });
  if (!ops.length) return null;
  return EditOpsSchema.parse({ ops, summary: say.length ? `I'll ${say.join(", ")}.` : "Applying your change." });
}

/** Does this request need creative rewriting (copy, language, concept) that only the AI Director can do? */
export function needsAi(text: string): boolean {
  return /translat|\b(egyptian |levantine |gulf )?arabic\b|\b(in|into|use) (english|french|spanish|german)\b|rewrite|new (copy|script|concept|idea)|different (style|concept|angle)|another version with|more (premium|luxur|emotional|funny|playful)|tone|wording|catchier|music/i.test(text);
}
