import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { NodeTypeInfo, PortSpec } from "@/shared/schema";
import { ASPECTS, ASPECT_SIZES, DirectorPlanSchema } from "@/shared/schema";
import { getAdapter, readyCapabilities, capabilitySpec } from "../adapters/registry";
import { AdapterError, type ArtifactOut, type ExecContext, type ExecResult } from "../adapters/types";
import { getAsset, importFile } from "../assets";
import { parseSrt } from "../adapters/whisper";
import { fileRef } from "../adapters/remotion";
import { getSettings } from "../settings";
import { isUnderAny } from "../util/paths";
import { CommercialPropsSchema, CommercialSceneSchema, PaletteSchema } from "../../../remotion/schema";

/** A value flowing into a node input: an asset reference or an inline value. */
export interface InVal {
  assetId?: string;
  path?: string;
  kind?: string;
  value?: unknown;
  meta?: Record<string, unknown>;
}
export type ResolvedInputs = Record<string, InVal[]>;

export interface NodeRunCtx<P> {
  params: P;
  inputs: ResolvedInputs;
  exec: ExecContext;
  /** Call a verified capability: `adapter.operation`. */
  call: (capability: string, params: Record<string, unknown>) => Promise<ExecResult>;
}

export interface NodeDef<P = Record<string, unknown>> {
  type: string;
  family: NodeTypeInfo["family"];
  label: string;
  description: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  params: z.ZodType<P>;
  /** Capability required. null = built-in logic. */
  capability: string | null;
  /** Additional capabilities used (all must be ready). */
  alsoRequires?: string[];
  /** Estimate inputs for cost: which capability/params would be billed. */
  estimate?: (p: P, inputs: ResolvedInputs) => { capability: string; params: Record<string, unknown> } | null;
  /** Logic nodes the engine handles itself (approval/condition). */
  builtin?: "approval" | "condition";
  run?: (ctx: NodeRunCtx<P>) => Promise<ExecResult>;
  /** Reason a family member is intentionally unavailable (no verified provider). */
  unavailableReason?: string;
}

const firstPath = (inputs: ResolvedInputs, port: string, required = true): string | undefined => {
  const v = inputs[port]?.[0];
  if (!v?.path && required) throw new AdapterError("INVALID_INPUT", `input "${port}" is required`);
  return v?.path;
};
const allPaths = (inputs: ResolvedInputs, port: string) => (inputs[port] ?? []).map((v) => v.path).filter((p): p is string => !!p);
const firstValue = (inputs: ResolvedInputs, port: string) => inputs[port]?.[0]?.value;

const port = (name: string, type: PortSpec["type"], extra: Partial<PortSpec> = {}): PortSpec => ({ name, type, ...extra });
const Aspect = z.enum(ASPECTS);

/* --------------------------------- AI --------------------------------- */

const directorNode: NodeDef<{ brief: string; constraints: string; model?: string; maxBudgetUsd: number }> = {
  type: "ai.director",
  family: "ai",
  label: "Creative Director",
  description: "Turns a brief into a schema-validated plan: script, storyboard and shot list. Proposes only; never executes.",
  inputs: [port("brief", "text", { optional: true })],
  outputs: [port("storyboard", "storyboard"), port("script", "text")],
  params: z.object({ brief: z.string().max(8000).default(""), constraints: z.string().max(4000).default(""), model: z.string().max(60).optional(), maxBudgetUsd: z.number().min(0.05).max(20).default(3) }),
  capability: "claude.plan",
  estimate: () => ({ capability: "claude.plan", params: {} }),
  run: async ({ params, inputs, exec }) => {
    const { directorPlan } = await import("../director");
    const brief = [params.brief, String(firstValue(inputs, "brief") ?? "")].filter(Boolean).join("\n\n");
    if (!brief.trim()) throw new AdapterError("INVALID_INPUT", "brief is empty");
    const res = await directorPlan({ brief, constraints: params.constraints, model: params.model, maxBudgetUsd: params.maxBudgetUsd, signal: exec.signal });
    const f = path.join(exec.workDir, "plan.json");
    fs.writeFileSync(f, JSON.stringify(res.plan, null, 2));
    const s = path.join(exec.workDir, "script.txt");
    fs.writeFileSync(s, res.plan.script);
    return {
      artifacts: [
        { file: f, kind: "json", port: "storyboard", label: `Plan: ${res.plan.title}` },
        { file: s, kind: "text", port: "script", label: "Script" },
      ],
      values: { storyboard: res.plan, script: res.plan.script },
      cost: { usd: res.costUsd, known: res.costUsd !== null, tokensIn: res.tokensIn, tokensOut: res.tokensOut, note: res.model },
    };
  },
};

const writeNode: NodeDef<{ instruction: string; model?: string; maxBudgetUsd: number }> = {
  type: "ai.write",
  family: "ai",
  label: "Script / Prompt Writer",
  description: "Schema-validated copywriting (script lines, prompts, captions copy) from an instruction and context.",
  inputs: [port("context", "any", { optional: true, multiple: true })],
  outputs: [port("text", "text")],
  params: z.object({ instruction: z.string().min(1).max(8000), model: z.string().max(60).optional(), maxBudgetUsd: z.number().min(0.05).max(10).default(1) }),
  capability: "claude.write",
  estimate: () => ({ capability: "claude.write", params: {} }),
  run: async ({ params, inputs, call }) => {
    const context = (inputs.context ?? [])
      .map((v) => (v.value !== undefined ? (typeof v.value === "string" ? v.value : JSON.stringify(v.value)) : v.path && /\.(txt|json|srt|md)$/.test(v.path) ? fs.readFileSync(v.path, "utf8") : ""))
      .join("\n\n")
      .slice(0, 20000);
    return call("claude.write", { instruction: params.instruction, context, model: params.model, maxBudgetUsd: params.maxBudgetUsd });
  },
};

const reviewNode: NodeDef<{ brief: string; checklist: string[]; model?: string; maxBudgetUsd: number }> = {
  type: "ai.review",
  family: "ai",
  label: "Visual Reviewer",
  description: "AI inspects frames for artifacts, branding and legibility issues. Advisory; human approval stays in control.",
  inputs: [port("frames", "image", { multiple: true })],
  outputs: [port("report", "json")],
  params: z.object({ brief: z.string().max(4000).default(""), checklist: z.array(z.string().max(300)).max(30).default([]), model: z.string().max(60).optional(), maxBudgetUsd: z.number().min(0.05).max(10).default(1) }),
  capability: "claude.review",
  estimate: () => ({ capability: "claude.review", params: {} }),
  run: async ({ params, inputs, call }) => call("claude.review", { images: allPaths(inputs, "frames").slice(0, 24), brief: params.brief, checklist: params.checklist, model: params.model, maxBudgetUsd: params.maxBudgetUsd }),
};

/* --------------------------------- Image --------------------------------- */

const captureNode: NodeDef<{ url: string; width: number; height: number; deviceScaleFactor: number; locale: string; fullPage: boolean; scrollTo?: number; selector?: string; mobile: boolean; hideSelectors: string[] }> = {
  type: "image.capture",
  family: "image",
  label: "Capture Product UI",
  description: "Screenshot the real, live product UI with Playwright (no hallucinated interfaces).",
  inputs: [],
  outputs: [port("image", "image")],
  params: z.object({
    url: z.string().url(),
    width: z.number().int().min(320).max(3840).default(1440),
    height: z.number().int().min(320).max(3840).default(900),
    deviceScaleFactor: z.number().min(1).max(3).default(2),
    locale: z.string().max(20).default("ar-EG"),
    fullPage: z.boolean().default(false),
    scrollTo: z.number().int().min(0).optional(),
    selector: z.string().max(300).optional(),
    mobile: z.boolean().default(false),
    hideSelectors: z.array(z.string().max(200)).max(20).default([]),
  }),
  capability: "playwright.screenshot",
  run: ({ params, call }) => call("playwright.screenshot", params),
};

const gradeNode: NodeDef<{ width?: number; warming: number; vibrance: number; saturation: number; sharpen: boolean; format: "png" | "jpg" | "webp" }> = {
  type: "image.grade",
  family: "image",
  label: "Grade / Resize Image",
  description: "PhotoCraft: resize and apply a gentle photographic grade (photo filter, vibrance, sharpen).",
  inputs: [port("image", "image")],
  outputs: [port("image", "image")],
  params: z.object({ width: z.number().int().min(16).max(16000).optional(), warming: z.number().min(0).max(100).default(12), vibrance: z.number().min(-100).max(100).default(8), saturation: z.number().min(-100).max(100).default(-4), sharpen: z.boolean().default(true), format: z.enum(["png", "jpg", "webp"]).default("png") }),
  capability: "photocraft.grade",
  run: ({ params, inputs, call }) => call("photocraft.grade", { ...params, input: firstPath(inputs, "image") }),
};

const rasterizeNode: NodeDef<{ scale: number }> = {
  type: "image.rasterize",
  family: "image",
  label: "Rasterize Logo",
  description: "VectorCraft: convert SVG/PDF brand artwork to PNG.",
  inputs: [port("vector", "image")],
  outputs: [port("image", "image")],
  params: z.object({ scale: z.number().min(0.1).max(16).default(4) }),
  capability: "vectorcraft.rasterize",
  run: ({ params, inputs, call }) => call("vectorcraft.rasterize", { ...params, input: firstPath(inputs, "vector") }),
};

const posterNode: NodeDef<{ aspect: z.infer<typeof Aspect>; kicker: string; headline: string; sub: string; cta: string; direction: "rtl" | "ltr"; palette?: Record<string, string>; format: "png" | "jpeg" }> = {
  type: "image.poster",
  family: "image",
  label: "Poster",
  description: "Remotion still: brand poster with background visual, headline and logo.",
  inputs: [port("background", "image", { optional: true }), port("logo", "image", { optional: true })],
  outputs: [port("image", "image")],
  params: z.object({ aspect: Aspect.default("4:5"), kicker: z.string().max(120).default(""), headline: z.string().min(1).max(200), sub: z.string().max(300).default(""), cta: z.string().max(80).default(""), direction: z.enum(["rtl", "ltr"]).default("rtl"), palette: z.record(z.string(), z.string()).optional(), format: z.enum(["png", "jpeg"]).default("png") }),
  capability: "remotion.still",
  run: ({ params, inputs, call }) => {
    const size = ASPECT_SIZES[params.aspect];
    const bg = firstPath(inputs, "background", false);
    const logo = firstPath(inputs, "logo", false);
    return call("remotion.still", {
      composition: "Poster",
      format: params.format,
      props: { ...size, direction: params.direction, palette: PaletteSchema.parse(params.palette ?? {}), background: bg ? fileRef(bg) : null, logo: logo ? fileRef(logo) : null, kicker: params.kicker, headline: params.headline, sub: params.sub, cta: params.cta },
    });
  },
};

const unavailable = (type: string, family: NodeTypeInfo["family"], label: string, description: string, ports: { inputs: PortSpec[]; outputs: PortSpec[] }, reason: string): NodeDef => ({
  type,
  family,
  label,
  description,
  ...ports,
  params: z.object({ prompt: z.string().max(4000).default("") }).passthrough() as unknown as z.ZodType<Record<string, unknown>>,
  capability: `unverified.${type}`,
  unavailableReason: reason,
});

const NO_GEN = "No verified generation provider on this machine (no ComfyUI, no fal/Runway/Higgsfield API key). Configure one in Settings to enable.";

/* --------------------------------- Video --------------------------------- */

const recordNode: NodeDef<{ url: string; width: number; height: number; locale: string; durationS: number; scrollTo?: number; mobile: boolean; hideSelectors: string[] }> = {
  type: "video.capture",
  family: "video",
  label: "Record Product UI",
  description: "Record a smooth scroll walkthrough of the real product page (Playwright), encoded to MP4.",
  inputs: [],
  outputs: [port("video", "video")],
  params: z.object({ url: z.string().url(), width: z.number().int().min(320).max(3840).default(1920), height: z.number().int().min(320).max(3840).default(1080), locale: z.string().default("ar-EG"), durationS: z.number().min(1).max(60).default(8), scrollTo: z.number().int().min(0).optional(), mobile: z.boolean().default(false), hideSelectors: z.array(z.string().max(200)).max(20).default([]) }),
  capability: "playwright.record",
  alsoRequires: ["ffmpeg.encode"],
  run: async ({ params, call, exec }) => {
    const rec = await call("playwright.record", params);
    const webm = rec.artifacts[0].file;
    exec.progress(0.92, "encoding to MP4");
    const enc = await call("ffmpeg.encode", { input: webm, width: params.width, height: params.height, fps: 30, audio: false, crf: 18 });
    return { artifacts: [{ ...enc.artifacts[0], label: rec.artifacts[0].label, metadata: rec.artifacts[0].metadata }] };
  },
};

const stillVideoNode: NodeDef<{ durationS: number; aspect: z.infer<typeof Aspect>; fps: number; pushIn: boolean }> = {
  type: "video.still",
  family: "video",
  label: "Still → Motion",
  description: "FFmpeg: turn an image into a clip with a slow push-in (Ken Burns). Not AI image-to-video.",
  inputs: [port("image", "image")],
  outputs: [port("video", "video")],
  params: z.object({ durationS: z.number().min(0.2).max(120).default(4), aspect: Aspect.default("16:9"), fps: z.number().int().min(1).max(60).default(30), pushIn: z.boolean().default(true) }),
  capability: "ffmpeg.still",
  run: ({ params, inputs, call }) => call("ffmpeg.still", { image: firstPath(inputs, "image"), durationS: params.durationS, fps: params.fps, pushIn: params.pushIn, ...ASPECT_SIZES[params.aspect] }),
};

const encodeNode: NodeDef<{ aspect?: z.infer<typeof Aspect>; fps?: number; crf: number; format: "mp4" | "webm"; audio: boolean; maxBitrateK?: number }> = {
  type: "video.encode",
  family: "production",
  label: "Encode",
  description: "FFmpeg: H.264/AAC MP4 (web-safe, faststart) or VP9 WebM at a target size and frame rate.",
  inputs: [port("video", "video")],
  outputs: [port("video", "video")],
  params: z.object({ aspect: Aspect.optional(), fps: z.number().min(1).max(120).optional(), crf: z.number().int().min(0).max(51).default(20), format: z.enum(["mp4", "webm"]).default("mp4"), audio: z.boolean().default(true), maxBitrateK: z.number().int().min(100).max(100000).optional() }),
  capability: "ffmpeg.encode",
  run: ({ params, inputs, call }) => call("ffmpeg.encode", { input: firstPath(inputs, "video"), ...(params.aspect ? ASPECT_SIZES[params.aspect] : {}), fps: params.fps, crf: params.crf, format: params.format, audio: params.audio, maxBitrateK: params.maxBitrateK }),
};

const vfxNode: NodeDef<{ project?: string; template?: string; values?: Record<string, unknown>; comp?: string; format: "h264" | "prores" | "webm" }> = {
  type: "video.vfx",
  family: "video",
  label: "VFX / Motion (EffectCraft)",
  description: "Render an EffectCraft project or template (motion graphics, lower thirds, VFX).",
  inputs: [],
  outputs: [port("video", "video")],
  params: z.object({ project: z.string().max(500).optional(), template: z.string().max(500).optional(), values: z.record(z.string(), z.unknown()).optional(), comp: z.string().max(120).optional(), format: z.enum(["h264", "prores", "webm"]).default("h264") }),
  capability: "effectcraft.render",
  run: async ({ params, call }) => {
    const roots = getSettings().importRoots;
    for (const f of [params.project, params.template]) if (f && !isUnderAny(f, roots)) throw new AdapterError("INVALID_INPUT", `${f} is outside the allowed import folders`);
    return call("effectcraft.render", params);
  },
};

const loopNode: NodeDef<{ crossfadeS: number; webm: boolean }> = {
  type: "video.loop",
  family: "video",
  label: "Seamless Loop",
  description: "FFmpeg: crossfade the tail into the head for a seamless, muted homepage loop (MP4 + WebM).",
  inputs: [port("video", "video")],
  outputs: [port("video", "video"), port("webm", "video", { optional: true })],
  params: z.object({ crossfadeS: z.number().min(0.1).max(5).default(1), webm: z.boolean().default(true) }),
  capability: "ffmpeg.loop",
  run: ({ params, inputs, call }) => call("ffmpeg.loop", { input: firstPath(inputs, "video"), ...params }),
};

/* --------------------------------- Audio --------------------------------- */

const voiceoverNode: NodeDef<{ text: string; voiceId: string; modelId: string; languageCode?: string; stability: number; similarityBoost: number; style: number; speed: number; seed?: number }> = {
  type: "audio.voiceover",
  family: "audio",
  label: "Voiceover (ElevenLabs)",
  description: "Paid TTS with ElevenLabs (multilingual, incl. Egyptian Arabic). Requires approval. Verify pronunciation by listening.",
  inputs: [port("script", "text", { optional: true })],
  outputs: [port("audio", "audio")],
  params: z.object({ text: z.string().max(10000).default(""), voiceId: z.string().max(60).default(""), modelId: z.string().max(60).default("eleven_multilingual_v2"), languageCode: z.string().max(5).optional(), stability: z.number().min(0).max(1).default(0.45), similarityBoost: z.number().min(0).max(1).default(0.8), style: z.number().min(0).max(1).default(0.2), speed: z.number().min(0.7).max(1.2).default(1), seed: z.number().int().optional() }),
  capability: "elevenlabs.tts",
  estimate: (p, inputs) => ({ capability: "elevenlabs.tts", params: { text: p.text || String(firstValue(inputs, "script") ?? ""), usdPerCharacter: getSettings().elevenlabsUsdPerChar ?? undefined } }),
  run: ({ params, inputs, call }) => {
    const text = params.text || String(firstValue(inputs, "script") ?? "");
    const voiceId = params.voiceId || getSettings().defaultVoiceId || "";
    return call("elevenlabs.tts", { ...params, text, voiceId });
  },
};

const localTtsNode: NodeDef<{ text: string; voice: string; pace: number }> = {
  type: "audio.tts_local",
  family: "audio",
  label: "Scratch Narration (local, English)",
  description: "FilmCraft built-in TTS for timing scratch tracks. English only; robotic voice. Free.",
  inputs: [port("script", "text", { optional: true })],
  outputs: [port("audio", "audio")],
  params: z.object({ text: z.string().max(60000).default(""), voice: z.string().max(40).default("basic-female"), pace: z.number().min(0.5).max(2).default(1) }),
  capability: "filmcraft.tts",
  run: ({ params, inputs, call }) => call("filmcraft.tts", { ...params, text: params.text || String(firstValue(inputs, "script") ?? "") }),
};

const normalizeNode: NodeDef<{ format: "wav" | "m4a" }> = {
  type: "audio.normalize",
  family: "audio",
  label: "Loudness Normalize",
  description: "FFmpeg EBU R128 to -16 LUFS / -1.5 dBTP (web/social delivery).",
  inputs: [port("audio", "audio")],
  outputs: [port("audio", "audio")],
  params: z.object({ format: z.enum(["wav", "m4a"]).default("m4a") }),
  capability: "ffmpeg.loudnorm",
  run: ({ params, inputs, call }) => call("ffmpeg.loudnorm", { input: firstPath(inputs, "audio"), ...params }),
};

const transcribeNode: NodeDef<{ language: string; model?: "tiny" | "base" | "small" | "medium"; maxChars: number; prompt?: string }> = {
  type: "audio.transcribe",
  family: "audio",
  label: "Transcribe → Subtitles",
  description: "Local Whisper (whisper.cpp): word timestamps → SRT cues. Always review before export.",
  inputs: [port("audio", "any")],
  outputs: [port("subtitles", "subtitle"), port("words", "json")],
  params: z.object({ language: z.string().regex(/^(auto|[a-z]{2})$/).default("auto"), model: z.enum(["tiny", "base", "small", "medium"]).optional(), maxChars: z.number().int().min(10).max(80).default(42), prompt: z.string().max(400).optional() }),
  capability: "whisper.transcribe",
  run: ({ params, inputs, call }) => call("whisper.transcribe", { ...params, input: firstPath(inputs, "audio") }),
};

/* --------------------------------- Production --------------------------------- */

const importNode: NodeDef<{ assetId?: string; file?: string; kind?: string; label?: string }> = {
  type: "production.import",
  family: "production",
  label: "Import Asset",
  description: "Bring an existing library asset (by id) or a file from an allowed import folder into the graph.",
  inputs: [],
  outputs: [port("asset", "any")],
  params: z.object({ assetId: z.string().max(64).optional(), file: z.string().max(1000).optional(), kind: z.enum(["image", "video", "audio", "subtitle", "json", "text"]).optional(), label: z.string().max(200).optional() }),
  capability: null,
  run: async ({ params, exec }) => {
    if (params.assetId) {
      const a = getAsset(params.assetId);
      if (!a || a.projectId !== exec.projectId) throw new AdapterError("INVALID_INPUT", `asset ${params.assetId} not found in this project`);
      return { artifacts: [], values: { asset: { assetId: a.id } } };
    }
    if (!params.file) throw new AdapterError("INVALID_INPUT", "set assetId or file");
    const a = await importFile(params.file, getSettings().importRoots, { projectId: exec.projectId, kind: params.kind as never, label: params.label });
    return { artifacts: [], values: { asset: { assetId: a.id } } };
  },
};

const composeParams = z.object({
  aspect: Aspect.default("16:9"),
  fps: z.number().int().min(12).max(60).default(30),
  direction: z.enum(["rtl", "ltr"]).default("rtl"),
  palette: z.record(z.string(), z.string()).optional(),
  /**
   * Scene list. If a storyboard is connected, its scenes fill any field left empty here.
   * Explicit optional fields (no defaults): Zod's .partial() would keep the composition defaults
   * (e.g. visual: null) and silently drop every wired visual.
   */
  scenes: z
    .array(
      z.object({
        id: z.string().optional(),
        durationS: z.number().min(0.3).max(120).optional(),
        layout: z.enum(["full-bleed", "split", "title", "ui-showcase", "end-card"]).optional(),
        /** null = no visual (title card); omit to use the wired visual at visualIndex. */
        visual: z.object({ fit: z.enum(["cover", "contain"]).optional(), kenBurns: z.boolean().optional(), frame: z.enum(["none", "browser", "phone"]).optional(), scroll: z.boolean().optional(), startFromS: z.number().min(0).optional() }).nullable().optional(),
        visualIndex: z.number().int().min(0).optional(),
        kicker: z.string().max(200).optional(),
        headline: z.string().max(400).optional(),
        body: z.string().max(600).optional(),
        transition: z.enum(["fade", "slide", "none"]).optional(),
        placeholder: z.boolean().optional(),
      }),
    )
    .default([]),
  voiceoverDelayS: z.number().min(0).max(10).default(0.4),
  musicVolume: z.number().min(0).max(1).default(0.22),
  showCaptions: z.boolean().default(true),
  draftBanner: z.string().max(120).default(""),
  maxDurationS: z.number().min(1).max(600).optional(),
});

const composeNode: NodeDef<z.infer<typeof composeParams>> = {
  type: "production.compose",
  family: "production",
  label: "Remotion Composition",
  description: "Composite scenes, brand elements, UI captures, voiceover, music and captions into a finished commercial (any aspect).",
  inputs: [
    port("visuals", "any", { multiple: true, label: "scene visuals (image/video, in order)" }),
    port("storyboard", "storyboard", { optional: true }),
    port("voiceover", "audio", { optional: true }),
    port("music", "audio", { optional: true }),
    port("subtitles", "subtitle", { optional: true }),
    port("logo", "image", { optional: true, multiple: true, label: "logo (light), logo (reversed)" }),
  ],
  outputs: [port("video", "video")],
  params: composeParams,
  capability: "remotion.render",
  run: async ({ params, inputs, call }) => {
    const visuals = inputs.visuals ?? [];
    const plan = firstValue(inputs, "storyboard") as z.infer<typeof DirectorPlanSchema> | undefined;
    const planScenes = plan?.scenes ?? [];
    const count = Math.max(params.scenes.length, planScenes.length, params.scenes.length ? 0 : visuals.length);
    const scenes = Array.from({ length: count }, (_, i) => {
      const o = params.scenes[i] ?? {};
      const ps = planScenes[i];
      const vi = o.visualIndex ?? i;
      const v = visuals[vi];
      const isVideo = v?.kind === "video" || (v?.path ? /\.(mp4|webm|mov)$/i.test(v.path) : false);
      return CommercialSceneSchema.parse({
        id: o.id ?? `s${i + 1}`,
        durationS: o.durationS ?? ps?.durationS ?? 4,
        layout: o.layout ?? (i === count - 1 ? "end-card" : "full-bleed"),
        visual: o.visual === null ? null : v?.path ? { type: isVideo ? "video" : "image", ...o.visual, src: fileRef(v.path) } : null,
        kicker: o.kicker ?? "",
        headline: o.headline ?? ps?.onScreenText ?? "",
        body: o.body ?? "",
        transition: o.transition ?? "fade",
        // A placeholder asset always marks the scene, whatever the plan assumed about its source.
        placeholder: o.placeholder === true || v?.meta?.placeholder === true,
      });
    });
    if (!scenes.length) throw new AdapterError("INVALID_INPUT", "no scenes: connect visuals or a storyboard, or define scenes");
    if (params.maxDurationS) {
      const total = scenes.reduce((s, x) => s + x.durationS, 0);
      if (total > params.maxDurationS + 0.01) throw new AdapterError("INVALID_INPUT", `scenes total ${total.toFixed(1)}s exceeds maxDurationS ${params.maxDurationS}s`);
    }
    const srt = firstPath(inputs, "subtitles", false);
    const captions = srt ? parseSrt(fs.readFileSync(srt, "utf8")).map(({ text, startMs, endMs }) => ({ text, startMs, endMs })) : [];
    const logos = allPaths(inputs, "logo");
    const vo = firstPath(inputs, "voiceover", false);
    const music = firstPath(inputs, "music", false);
    const props = CommercialPropsSchema.parse({
      ...ASPECT_SIZES[params.aspect],
      fps: params.fps,
      direction: params.direction,
      palette: PaletteSchema.parse(params.palette ?? {}),
      scenes,
      logo: logos[0] ? (fileRef(logos[0])) : null,
      logoReversed: logos[1] ? (fileRef(logos[1])) : null,
      voiceover: vo ? (fileRef(vo)) : null,
      voiceoverDelayS: params.voiceoverDelayS,
      music: music ? (fileRef(music)) : null,
      musicVolume: params.musicVolume,
      captions,
      showCaptions: params.showCaptions,
      draftBanner: params.draftBanner || (scenes.some((s) => s.placeholder) ? "DRAFT · placeholder visuals" : ""),
    });
    return call("remotion.render", { composition: "Commercial", props });
  },
};

const loopComposeNode: NodeDef<{ aspect: z.infer<typeof Aspect>; durationS: number; scrim: number; palette?: Record<string, string> }> = {
  type: "production.loop",
  family: "production",
  label: "Homepage Loop Composition",
  description: "Remotion: text-free, seamless brand loop from stills/UI captures (pair with Seamless Loop + Encode).",
  inputs: [port("images", "image", { multiple: true }), port("logo", "image", { optional: true })],
  outputs: [port("video", "video")],
  params: z.object({ aspect: Aspect.default("16:9"), durationS: z.number().min(2).max(60).default(12), scrim: z.number().min(0).max(0.9).default(0.2), palette: z.record(z.string(), z.string()).optional() }),
  capability: "remotion.render",
  run: ({ params, inputs, call }) => {
    const logo = firstPath(inputs, "logo", false);
    return call("remotion.render", {
      composition: "Loop",
      props: { ...ASPECT_SIZES[params.aspect], fps: 30, durationS: params.durationS, scrim: params.scrim, palette: PaletteSchema.parse(params.palette ?? {}), images: allPaths(inputs, "images").map((p) => (fileRef(p))), logo: logo ? fileRef(logo) : null },
    });
  },
};

const concatNode: NodeDef<{ aspect: z.infer<typeof Aspect>; fps: number }> = {
  type: "production.concat",
  family: "production",
  label: "Assemble (Concat)",
  description: "FFmpeg: join clips end to end at one size/fps (silent clips get silent audio).",
  inputs: [port("clips", "video", { multiple: true })],
  outputs: [port("video", "video")],
  params: z.object({ aspect: Aspect.default("16:9"), fps: z.number().int().min(1).max(60).default(30) }),
  capability: "ffmpeg.concat",
  run: ({ params, inputs, call }) => call("ffmpeg.concat", { inputs: allPaths(inputs, "clips"), fps: params.fps, ...ASPECT_SIZES[params.aspect] }),
};

const muxNode: NodeDef<{ volumes: number[]; delaysS: number[]; keepVideoAudio: boolean; loudnorm: boolean }> = {
  type: "production.mix",
  family: "audio",
  label: "Mix Audio",
  description: "FFmpeg: mix voiceover/music/SFX tracks under a video with per-track volume and delay, loudness-normalized.",
  inputs: [port("video", "video"), port("tracks", "audio", { multiple: true })],
  outputs: [port("video", "video")],
  params: z.object({ volumes: z.array(z.number().min(0).max(4)).max(16).default([]), delaysS: z.array(z.number().min(0).max(600)).max(16).default([]), keepVideoAudio: z.boolean().default(false), loudnorm: z.boolean().default(true) }),
  capability: "ffmpeg.mux",
  run: ({ params, inputs, call }) =>
    call("ffmpeg.mux", {
      video: firstPath(inputs, "video"),
      tracks: allPaths(inputs, "tracks").map((p, i) => ({ path: p, volume: params.volumes[i] ?? 1, delayS: params.delaysS[i] ?? 0 })),
      keepVideoAudio: params.keepVideoAudio,
      loudnorm: params.loudnorm,
    }),
};

const subtitlesNode: NodeDef<{ language: string }> = {
  type: "production.subtitles",
  family: "production",
  label: "Attach Subtitles",
  description: "FFmpeg: mux an SRT as a soft subtitle track (mov_text) for platforms that support it.",
  inputs: [port("video", "video"), port("subtitles", "subtitle")],
  outputs: [port("video", "video")],
  params: z.object({ language: z.string().regex(/^[a-z]{3}$/).default("ara") }),
  capability: "ffmpeg.subtitles",
  run: ({ params, inputs, call }) => call("ffmpeg.subtitles", { video: firstPath(inputs, "video"), srt: firstPath(inputs, "subtitles"), language: params.language }),
};

const posterFrameNode: NodeDef<{ timeS: number; format: "png" | "jpg" }> = {
  type: "production.poster_frame",
  family: "production",
  label: "Poster Frame",
  description: "FFmpeg: export one frame at a timestamp (thumbnail / poster image for a video tag).",
  inputs: [port("video", "video")],
  outputs: [port("image", "image")],
  params: z.object({ timeS: z.number().min(0).default(1), format: z.enum(["png", "jpg"]).default("jpg") }),
  capability: "ffmpeg.poster",
  run: ({ params, inputs, call }) => call("ffmpeg.poster", { input: firstPath(inputs, "video"), ...params }),
};

const qaParams = z.object({
  expectWidth: z.number().int().optional(),
  expectHeight: z.number().int().optional(),
  expectFps: z.number().optional(),
  minDurationS: z.number().optional(),
  maxDurationS: z.number().optional(),
  requireAudio: z.boolean().default(true),
  frames: z.number().int().min(1).max(24).default(6),
  maxBytes: z.number().int().optional(),
});

const qaNode: NodeDef<z.infer<typeof qaParams>> = {
  type: "production.qa",
  family: "production",
  label: "Technical QA",
  description: "FFprobe checks (resolution, aspect, fps, duration, audio streams, integrity) + representative frames for review.",
  inputs: [port("video", "video"), port("subtitles", "subtitle", { optional: true })],
  outputs: [port("report", "json"), port("frames", "image", { multiple: true })],
  params: qaParams,
  capability: "ffmpeg.probe",
  alsoRequires: ["ffmpeg.frames"],
  run: async ({ params, inputs, call, exec }) => {
    const { technicalQa } = await import("../qa");
    const video = firstPath(inputs, "video")!;
    const report = await technicalQa(video, params, exec.signal, firstPath(inputs, "subtitles", false));
    const frames = await call("ffmpeg.frames", { input: video, count: params.frames });
    const f = path.join(exec.workDir, "qa-report.json");
    fs.writeFileSync(f, JSON.stringify(report, null, 2));
    if (!report.pass) exec.log("warn", `QA failed: ${report.checks.filter((c) => !c.pass).map((c) => c.name).join(", ")}`);
    return { artifacts: [{ file: f, kind: "json", port: "report", label: `QA ${report.pass ? "PASS" : "FAIL"}` }, ...frames.artifacts], values: { report } };
  },
};

const exportNode: NodeDef<{ name: string; deliverable: string }> = {
  type: "production.export",
  family: "production",
  label: "Export Deliverable",
  description: "Copy a finished asset to the project's exports folder under a delivery name and tag it as a deliverable.",
  inputs: [port("asset", "any")],
  outputs: [port("asset", "any")],
  params: z.object({ name: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/, "file-safe name, no extension"), deliverable: z.string().max(120).default("") }),
  capability: null,
  run: async ({ params, inputs, exec }) => {
    // Every media input is exported (e.g. MP4 + WebM of a loop); QA reports and other JSON are not deliverables.
    const media = (inputs.asset ?? []).filter((v) => v.path && ["video", "image", "audio", "subtitle"].includes(v.kind ?? ""));
    if (!media.length) throw new AdapterError("INVALID_INPUT", "nothing to export");
    const { exportDeliverable } = await import("../exports");
    const files = media.map((v) => ({ assetId: v.assetId, exportedTo: exportDeliverable(exec.projectId, v.path!, params.name) }));
    exec.log("info", `exported ${files.map((f) => path.basename(f.exportedTo)).join(", ")}`);
    return { artifacts: [], values: { asset: { assetId: media[0].assetId, files, deliverable: params.deliverable || params.name } } };
  },
};

/* --------------------------------- Logic --------------------------------- */

const approvalNode: NodeDef<{ title: string; instructions: string }> = {
  type: "logic.approval",
  family: "logic",
  label: "Approval Gate",
  description: "Pause here until a person approves (creative checkpoint). Rejecting fails this branch.",
  inputs: [port("in", "any", { multiple: true })],
  outputs: [port("out", "any")],
  params: z.object({ title: z.string().max(200).default("Creative approval"), instructions: z.string().max(2000).default("") }),
  capability: null,
  builtin: "approval",
};

const conditionNode: NodeDef<{ path: string; op: "eq" | "ne" | "gt" | "lt" | "exists" | "truthy"; value?: unknown }> = {
  type: "logic.condition",
  family: "logic",
  label: "Condition",
  description: "Route on a field of a JSON input (e.g. QA report pass). No code: a path, an operator and a value.",
  inputs: [port("in", "json")],
  outputs: [port("true", "json"), port("false", "json")],
  params: z.object({ path: z.string().regex(/^[A-Za-z0-9_.[\]]{1,200}$/).default("pass"), op: z.enum(["eq", "ne", "gt", "lt", "exists", "truthy"]).default("truthy"), value: z.unknown().optional() }),
  capability: null,
  builtin: "condition",
};

const selectNode: NodeDef<{ index: number }> = {
  type: "logic.select",
  family: "logic",
  label: "Asset Selector",
  description: "Pick one item from a multi-input (e.g. the approved take). Negative index counts from the end.",
  inputs: [port("in", "any", { multiple: true })],
  outputs: [port("out", "any")],
  params: z.object({ index: z.number().int().min(-100).max(100).default(0) }),
  capability: null,
  run: async ({ params, inputs }) => {
    const list = inputs.in ?? [];
    const v = list[params.index < 0 ? list.length + params.index : params.index];
    if (!v) throw new AdapterError("INVALID_INPUT", `no item at index ${params.index} (have ${list.length})`);
    return { artifacts: [], values: { out: v.assetId ? { assetId: v.assetId } : v.value } };
  },
};

const mergeNode: NodeDef<Record<string, never>> = {
  type: "logic.merge",
  family: "logic",
  label: "Join Branches",
  description: "Wait for parallel branches and pass all their outputs on as one list.",
  inputs: [port("in", "any", { multiple: true })],
  outputs: [port("out", "any", { multiple: true })],
  params: z.object({}) as unknown as z.ZodType<Record<string, never>>,
  capability: null,
  run: async ({ inputs }) => ({ artifacts: [], values: { out: (inputs.in ?? []).map((v) => (v.assetId ? { assetId: v.assetId } : v.value)) } }),
};

const textNode: NodeDef<{ text: string }> = {
  type: "logic.text",
  family: "logic",
  label: "Text",
  description: "A literal text value (brief, script, narration) to feed other nodes.",
  inputs: [],
  outputs: [port("text", "text")],
  params: z.object({ text: z.string().max(20000).default("") }),
  capability: null,
  run: async ({ params }) => ({ artifacts: [], values: { text: params.text } }),
};

/* --------------------------------- Mock (tests) --------------------------------- */

const mockNode: NodeDef<{ key?: string; text?: string; paid?: boolean }> = {
  type: "test.mock",
  family: "logic",
  label: "Mock (tests)",
  description: "Deterministic test node backed by the mock adapter. Only available when ORKESTR_ENABLE_MOCK=1.",
  inputs: [port("in", "any", { multiple: true, optional: true })],
  outputs: [port("out", "text")],
  params: z.object({ key: z.string().optional(), text: z.string().optional(), paid: z.boolean().optional() }),
  capability: "mock.text",
  estimate: (p) => (p.paid ? { capability: "mock.paid", params: {} } : null),
  run: async ({ params, inputs, call }) => {
    const ins = (inputs.in ?? []).map((v) => (v.path ? fs.readFileSync(v.path, "utf8") : String(v.value)));
    return call(params.paid ? "mock.paid" : "mock.text", { key: params.key, text: params.text, inputs: ins });
  },
};

/* --------------------------------- Registry --------------------------------- */

export const NODE_DEFS: NodeDef<any>[] = [
  directorNode,
  writeNode,
  reviewNode,
  captureNode,
  gradeNode,
  rasterizeNode,
  posterNode,
  unavailable("image.generate", "image", "Generate Image (AI)", "Text-to-image generation.", { inputs: [port("prompt", "text", { optional: true }), port("reference", "image", { optional: true, multiple: true })], outputs: [port("image", "image")] }, NO_GEN),
  unavailable("image.edit", "image", "Edit Image (AI)", "Prompted image edit / inpaint.", { inputs: [port("image", "image")], outputs: [port("image", "image")] }, NO_GEN),
  unavailable("image.upscale", "image", "Upscale Image", "Super-resolution upscaling.", { inputs: [port("image", "image")], outputs: [port("image", "image")] }, "Real-ESRGAN not installed and no upscaling API configured."),
  recordNode,
  stillVideoNode,
  vfxNode,
  loopNode,
  unavailable("video.generate", "video", "Generate Video (AI)", "Text-to-video generation.", { inputs: [port("prompt", "text", { optional: true })], outputs: [port("video", "video")] }, NO_GEN),
  unavailable("video.image_to_video", "video", "Image → Video (AI)", "Animate a still with a video model.", { inputs: [port("image", "image")], outputs: [port("video", "video")] }, NO_GEN),
  voiceoverNode,
  localTtsNode,
  normalizeNode,
  transcribeNode,
  muxNode,
  unavailable("audio.music", "audio", "Generate Music (AI)", "Music generation.", { inputs: [], outputs: [port("audio", "audio")] }, "No verified music provider. Import a licensed track with Import Asset."),
  unavailable("audio.sfx", "audio", "Generate SFX (AI)", "Sound-effect generation.", { inputs: [], outputs: [port("audio", "audio")] }, "No verified SFX provider configured. Import licensed SFX with Import Asset."),
  importNode,
  composeNode,
  loopComposeNode,
  concatNode,
  encodeNode,
  subtitlesNode,
  posterFrameNode,
  qaNode,
  exportNode,
  approvalNode,
  conditionNode,
  selectNode,
  mergeNode,
  textNode,
  mockNode,
];

const BY_TYPE = new Map(NODE_DEFS.map((d) => [d.type, d]));

export function getNodeDef(type: string): NodeDef<any> | undefined {
  const d = BY_TYPE.get(type);
  if (d?.type === "test.mock" && process.env.ORKESTR_ENABLE_MOCK !== "1") return undefined;
  return d;
}

export function isPaidNode(def: NodeDef<any>, params: unknown, inputs: ResolvedInputs = {}): boolean {
  if (def.estimate) {
    const est = def.estimate(params as never, inputs);
    if (!est) return false;
    return capabilitySpec(est.capability)?.paid ?? false;
  }
  return def.capability ? (capabilitySpec(def.capability)?.paid ?? false) : false;
}

export function nodeAvailability(def: NodeDef<any>, ready = readyCapabilities()): { available: boolean; reason?: string } {
  if (def.unavailableReason) return { available: false, reason: def.unavailableReason };
  const needed = [def.capability, ...(def.alsoRequires ?? [])].filter((c): c is string => !!c);
  for (const c of needed) {
    if (!ready.has(c)) {
      const [adapterId] = c.split(".");
      return { available: false, reason: `${c} is not ready (${getAdapter(adapterId) ? "see Settings → Tools" : "no adapter"})` };
    }
  }
  return { available: true };
}

export function nodeTypeInfos(): NodeTypeInfo[] {
  const ready = readyCapabilities();
  return NODE_DEFS.filter((d) => d.type !== "test.mock" || process.env.ORKESTR_ENABLE_MOCK === "1").map((d) => {
    const av = nodeAvailability(d, ready);
    let schema: unknown = {};
    let defaults: Record<string, unknown> = {};
    try {
      schema = z.toJSONSchema(d.params, { io: "input", unrepresentable: "any" });
    } catch {
      schema = {};
    }
    try {
      defaults = (d.params.safeParse({}).data ?? {}) as Record<string, unknown>;
    } catch {
      defaults = {};
    }
    return {
      type: d.type,
      family: d.family,
      label: d.label,
      description: d.description,
      inputs: d.inputs,
      outputs: d.outputs,
      paramsJsonSchema: schema,
      defaults,
      capability: d.capability,
      available: av.available,
      unavailableReason: av.reason,
      paid: d.capability ? (capabilitySpec(d.capability)?.paid ?? false) : false,
    };
  });
}

export type { ArtifactOut };
