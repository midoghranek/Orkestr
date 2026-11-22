import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { allowExecutable, runAllowed, runFile } from "../util/proc";
import {
  AdapterError,
  checkAborted,
  type CapabilitySpec,
  type CostEstimate,
  type Discovery,
  type ExecContext,
  type ExecResult,
  type Health,
  type ToolAdapter,
} from "./types";

/**
 * Adapters for the locally installed ArtCraft suite (headless CLIs).
 * These are editing/compositing engines — not generative models. Only operations verified
 * against the installed builds (help output + smoke runs during Phase 0) are exposed.
 */
export function artcraftDir(): string {
  return process.env.ORKESTR_ARTCRAFT_DIR ?? "C:\\Program Files\\ArtCraft";
}

const FREE = { model: "free" as const, note: "Local ArtCraft engine; no per-use cost." };

abstract class CraftAdapter implements ToolAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  readonly kind = "local-cli" as const;
  protected abstract readonly exeRel: string;
  protected version?: string;

  protected exePath(): string {
    return path.join(artcraftDir(), this.exeRel);
  }

  async discover(): Promise<Discovery> {
    const exe = this.exePath();
    if (!fs.existsSync(exe)) return { found: false, reason: `${exe} not found` };
    allowExecutable(this.id, exe);
    const res = await runFile(exe, ["--version"], { timeoutMs: 20_000 });
    const text = (res.stdout + res.stderr).trim();
    const m = /(\d+\.\d+\.\d+)/.exec(text);
    this.version = m?.[1];
    return { found: res.code === 0, version: this.version, path: exe, details: { versionLine: text.split(/\r?\n/)[0] } };
  }

  async validateConfig() {
    return { ok: fs.existsSync(this.exePath()), issues: fs.existsSync(this.exePath()) ? [] : [`missing ${this.exePath()}`] };
  }

  abstract capabilities(): CapabilitySpec[];
  protected abstract smoke(): Promise<{ ok: boolean; message: string; blocked?: Record<string, string> }>;

  async healthCheck(): Promise<Health> {
    const t = Date.now();
    const d = await this.discover();
    if (!d.found) return { status: "unavailable", message: d.reason ?? "not found", checkedAt: t, readyCapabilities: [], blocked: {} };
    const s = await this.smoke().catch((e: Error) => ({ ok: false, message: e.message, blocked: {} as Record<string, string> }));
    const blocked = s.blocked ?? {};
    return {
      status: s.ok ? (Object.keys(blocked).length ? "degraded" : "healthy") : "degraded",
      message: `${this.name} ${this.version ?? ""}: ${s.message}`,
      checkedAt: t,
      latencyMs: Date.now() - t,
      readyCapabilities: s.ok ? this.capabilities().map((c) => c.id).filter((id) => !blocked[id]) : [],
      blocked,
    };
  }

  async estimateCost(): Promise<CostEstimate> {
    return { usd: 0, known: true, basis: `local ${this.name}` };
  }

  protected async run(args: string[], ctx: ExecContext, timeoutMs = 30 * 60_000) {
    checkAborted(ctx.signal);
    const res = await runAllowed(this.id, args, { signal: ctx.signal, timeoutMs, cwd: ctx.workDir });
    if (res.aborted) throw new AdapterError("CANCELLED", `${this.name} cancelled`);
    if (res.timedOut) throw new AdapterError("TIMEOUT", `${this.name} timed out`);
    if (res.code !== 0) throw new AdapterError("TOOL_FAILED", `${this.name} exited ${res.code}: ${(res.stderr || res.stdout).slice(-800)}`);
    return res;
  }

  abstract execute(operation: string, params: Record<string, unknown>, ctx: ExecContext): Promise<ExecResult>;

  protected cap(op: string, label: string, description: string, inF: string[], outF: string[], extra: Partial<CapabilitySpec> = {}): CapabilitySpec {
    return {
      id: `${this.id}.${op}`,
      adapter: this.id,
      operation: op,
      label,
      description,
      inputFormats: inF,
      outputFormats: outF,
      paid: false,
      cost: FREE,
      verifiedBy: "CLI help + Phase 0 smoke run on the installed build",
      ...extra,
    };
  }
}

/* ------------------------------ PhotoCraft ------------------------------ */

export class PhotoCraftAdapter extends CraftAdapter {
  readonly id = "photocraft";
  readonly name = "PhotoCraft";
  protected readonly exeRel = "PhotoCraft\\photocraft-cli.exe";

  capabilities() {
    return [
      this.cap("info", "Image info", "Document size, mode, depth and layer tree as JSON.", ["png", "jpg", "webp", "psd", "tif"], ["json"]),
      this.cap("convert", "Convert image", "Convert between PNG/JPG/WebP/TIFF/PSD/EXR.", ["png", "jpg", "webp", "psd", "tif"], ["png", "jpg", "webp", "tif"]),
      this.cap("grade", "Resize + grade", "Resize (bicubic sharper) and apply a gentle photographic grade: photo filter, vibrance, unsharp mask.", ["png", "jpg", "webp"], ["png", "jpg", "webp"]),
    ];
  }

  protected async smoke() {
    const res = await runAllowed(this.id, ["commands"], { timeoutMs: 30_000 });
    const ok = res.code === 0 && res.stdout.includes("image.imageSize") && res.stdout.includes("image.adjustments.photoFilter");
    return { ok, message: ok ? "engine command registry lists imageSize/photoFilter" : "command registry check failed" };
  }

  async execute(operation: string, params: Record<string, unknown>, ctx: ExecContext): Promise<ExecResult> {
    switch (operation) {
      case "info": {
        const p = z.object({ input: z.string() }).parse(params);
        const res = await this.run(["info", p.input], ctx);
        const f = path.join(ctx.workDir, "info.json");
        fs.writeFileSync(f, res.stdout);
        return { artifacts: [{ file: f, kind: "json", port: "info" }] };
      }
      case "convert": {
        const p = z.object({ input: z.string(), format: z.enum(["png", "jpg", "webp", "tif"]) }).parse(params);
        const f = path.join(ctx.workDir, `converted.${p.format}`);
        await this.run(["convert", p.input, f], ctx);
        return { artifacts: [{ file: f, kind: "image", port: "image" }] };
      }
      case "grade": {
        const p = z
          .object({
            input: z.string(),
            width: z.number().int().min(16).max(16000).optional(),
            warming: z.number().min(0).max(100).default(12),
            vibrance: z.number().min(-100).max(100).default(8),
            saturation: z.number().min(-100).max(100).default(-4),
            sharpen: z.boolean().default(true),
            format: z.enum(["png", "jpg", "webp"]).default("png"),
          })
          .parse(params);
        const args = ["run", p.input];
        if (p.width) args.push("--cmd", "image.imageSize", "--params", JSON.stringify({ width: p.width, resample: "bicubicSharper" }));
        if (p.warming > 0) args.push("--cmd", "image.adjustments.photoFilter", "--params", JSON.stringify({ filter: "warming81", density: p.warming, preserveLuminosity: true }));
        if (p.vibrance || p.saturation) args.push("--cmd", "image.adjustments.vibrance", "--params", JSON.stringify({ vibrance: p.vibrance, saturation: p.saturation }));
        if (p.sharpen) args.push("--cmd", "filter.sharpen.unsharpMask", "--params", JSON.stringify({ amount: 45, radius: 0.8, threshold: 2 }));
        const f = path.join(ctx.workDir, `graded.${p.format}`);
        args.push("--out", f);
        await this.run(args, ctx);
        return { artifacts: [{ file: f, kind: "image", port: "image" }] };
      }
      default:
        throw new AdapterError("UNSUPPORTED", `photocraft has no operation ${operation}`);
    }
  }
}

/* ------------------------------ FilmCraft ------------------------------ */

export class FilmCraftAdapter extends CraftAdapter {
  readonly id = "filmcraft";
  readonly name = "FilmCraft";
  protected readonly exeRel = "FilmCraft\\filmcraft-cli.exe";

  capabilities() {
    return [
      this.cap("probe", "Probe media", "Media info as JSON (incl. MXF/Ogg/BWF details).", ["video", "audio"], ["json"]),
      this.cap("tts", "Narration (TTS)", "Synthesize narration with FilmCraft's built-in voices.", ["text"], ["wav"], {
        limitations: ["English (en-US) only — cannot voice Arabic", "built-in voices are robotic; natural Kokoro voices need a 336 MB download"],
      }),
      this.cap("transcribe", "Transcribe (Whisper)", "Speech-to-text inside FilmCraft.", ["audio", "video"], ["srt"], {
        limitations: ["This build was compiled without the `whisper` feature (verified): use whisper.transcribe instead"],
      }),
    ];
  }

  protected async smoke() {
    const res = await runAllowed(this.id, ["exec", "tts.voices"], { timeoutMs: 60_000 });
    const ok = res.code === 0 && res.stdout.includes("basic-female");
    return {
      ok,
      message: ok ? "tts.voices lists the built-in voices" : "tts.voices failed",
      blocked: { "filmcraft.transcribe": "speech-to-text is not available in this build (built without the `whisper` feature)" },
    };
  }

  private async script(lines: { id: string; params: Record<string, unknown> }[], ctx: ExecContext) {
    const f = path.join(ctx.workDir, "filmcraft-script.jsonl");
    fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n"));
    const res = await this.run(["run", f], ctx);
    const results = res.stdout
      .split(/\r?\n/)
      .filter((l) => l.trim().startsWith("{"))
      .map((l) => JSON.parse(l) as { id: string; ok: boolean; error?: string; result?: unknown });
    const failed = results.find((r) => !r.ok);
    if (failed) throw new AdapterError("TOOL_FAILED", `FilmCraft ${failed.id}: ${failed.error}`);
    return results;
  }

  async execute(operation: string, params: Record<string, unknown>, ctx: ExecContext): Promise<ExecResult> {
    switch (operation) {
      case "probe": {
        const p = z.object({ input: z.string() }).parse(params);
        const res = await this.run(["probe", p.input], ctx);
        const f = path.join(ctx.workDir, "probe.json");
        fs.writeFileSync(f, res.stdout);
        return { artifacts: [{ file: f, kind: "json", port: "probe" }] };
      }
      case "tts": {
        const p = z
          .object({
            text: z.string().min(1).max(60_000),
            voice: z.string().regex(/^[a-z0-9-]+$/).default("basic-female"),
            pace: z.number().min(0.5).max(2).default(1),
            pitch: z.enum(["extraLow", "low", "default", "high", "extraHigh"]).default("default"),
          })
          .parse(params);
        if (/[\u0600-\u06FF]/.test(p.text)) throw new AdapterError("UNSUPPORTED", "FilmCraft TTS is English-only; Arabic text needs ElevenLabs");
        const out = path.join(ctx.workDir, "narration.wav");
        await this.script(
          [
            { id: "file.newProject", params: { name: "orkestr-tts" } },
            { id: "file.newSequence", params: { name: "vo", width: 1920, height: 1080, fps: 30 } },
            { id: "tts.create", params: { text: p.text, voice: p.voice, pace: p.pace, pitch: p.pitch, dir: ctx.workDir } },
            { id: "tts.render", params: { wait: true } },
            { id: "file.exportMedia", params: { path: out, format: "wav" } },
          ],
          ctx,
        );
        if (!fs.existsSync(out)) throw new AdapterError("INVALID_OUTPUT", "FilmCraft did not write the narration file");
        return { artifacts: [{ file: out, kind: "audio", port: "audio", label: `TTS (${p.voice})` }] };
      }
      case "transcribe":
        throw new AdapterError("NOT_AVAILABLE", "FilmCraft in this install has no speech-to-text (built without `whisper`)");
      default:
        throw new AdapterError("UNSUPPORTED", `filmcraft has no operation ${operation}`);
    }
  }
}

/* ------------------------------ SoundCraft ------------------------------ */

export class SoundCraftAdapter extends CraftAdapter {
  readonly id = "soundcraft";
  readonly name = "SoundCraft";
  protected readonly exeRel = "SoundCraft\\soundcraft-cli.exe";

  capabilities() {
    return [
      this.cap("info", "Audio info", "An audio file's format as JSON.", ["wav", "mp3", "flac", "m4a", "ogg"], ["json"]),
      this.cap("convert", "Convert / normalize audio", "Resample, change bit depth and peak-normalize to -0.1 dBFS.", ["wav", "mp3", "flac", "m4a", "ogg", "mp4"], ["wav", "flac", "aiff"], {
        limitations: ["No text-to-speech (verified: no TTS command in the registry)", "Peak normalization only; use ffmpeg.loudnorm for LUFS targets"],
      }),
    ];
  }

  protected async smoke() {
    const res = await runAllowed(this.id, ["convert", "--help"], { timeoutMs: 20_000 });
    return { ok: res.code === 0 && res.stdout.includes("--normalize"), message: "convert --help lists --normalize" };
  }

  async execute(operation: string, params: Record<string, unknown>, ctx: ExecContext): Promise<ExecResult> {
    switch (operation) {
      case "info": {
        const p = z.object({ input: z.string() }).parse(params);
        const res = await this.run(["info", p.input], ctx);
        const f = path.join(ctx.workDir, "info.json");
        fs.writeFileSync(f, res.stdout);
        return { artifacts: [{ file: f, kind: "json", port: "info" }] };
      }
      case "convert": {
        const p = z
          .object({ input: z.string(), format: z.enum(["wav", "flac", "aiff"]).default("wav"), rate: z.number().int().min(8000).max(192000).optional(), bitDepth: z.enum(["16", "24", "32f"]).default("24"), normalize: z.boolean().default(true) })
          .parse(params);
        const f = path.join(ctx.workDir, `audio.${p.format}`);
        const args = ["convert", p.input, f, "--bit-depth", p.bitDepth];
        if (p.rate) args.push("--rate", String(p.rate));
        if (p.normalize) args.push("--normalize");
        await this.run(args, ctx);
        return { artifacts: [{ file: f, kind: "audio", port: "audio" }] };
      }
      default:
        throw new AdapterError("UNSUPPORTED", `soundcraft has no operation ${operation}`);
    }
  }
}

/* ------------------------------ EffectCraft ------------------------------ */

export class EffectCraftAdapter extends CraftAdapter {
  readonly id = "effectcraft";
  readonly name = "EffectCraft";
  protected readonly exeRel = "EffectCraft\\effectcraft-cli.exe";

  capabilities() {
    return [
      this.cap("render", "Render motion/VFX project", "Render an EffectCraft project (.ecproj) or template (.ectemplate + values) to H.264/ProRes/WebM/PNG.", ["ecproj", "ectemplate"], ["mp4", "mov", "webm", "png"], {
        limitations: ["Requires an existing project/template file authored in EffectCraft"],
      }),
      this.cap("renderFrame", "Render VFX frame", "Render one frame of a composition to PNG (optionally transparent).", ["ecproj"], ["png"]),
    ];
  }

  protected async smoke() {
    const res = await runAllowed(this.id, ["info", "--json"], { timeoutMs: 30_000 });
    return { ok: res.code === 0 && res.stdout.includes("activeComp"), message: "headless engine opened its default project" };
  }

  async execute(operation: string, params: Record<string, unknown>, ctx: ExecContext): Promise<ExecResult> {
    const base = z.object({ project: z.string().optional(), template: z.string().optional(), values: z.record(z.string(), z.unknown()).optional(), comp: z.string().max(120).optional() });
    switch (operation) {
      case "render": {
        const p = base.extend({ format: z.enum(["h264", "prores", "webm", "png"]).default("h264"), start: z.number().optional(), end: z.number().optional() }).parse(params);
        const ext = p.format === "h264" ? "mp4" : p.format === "prores" ? "mov" : p.format === "webm" ? "webm" : "png";
        const f = path.join(ctx.workDir, `vfx.${ext}`);
        const args = ["render"];
        if (p.template) {
          args.push("--template", p.template);
          if (p.values) {
            const vf = path.join(ctx.workDir, "values.json");
            fs.writeFileSync(vf, JSON.stringify(p.values));
            args.push("--values", vf);
          }
        }
        if (p.comp) args.push("--comp", p.comp);
        args.push("--out", f, "--format", p.format);
        if (p.start !== undefined) args.push("--start", String(p.start));
        if (p.end !== undefined) args.push("--end", String(p.end));
        if (p.project && !p.template) args.push("--project", p.project);
        else if (!p.template) throw new AdapterError("INVALID_INPUT", "effectcraft.render needs a project or template file");
        await this.run(args, ctx);
        return { artifacts: [{ file: f, kind: ext === "png" ? "image" : "video", port: "video" }] };
      }
      case "renderFrame": {
        const p = base.extend({ timeS: z.number().min(0).default(0), transparent: z.boolean().default(false) }).parse(params);
        const f = path.join(ctx.workDir, "vfx-frame.png");
        const args = ["render-frame", "--time", String(p.timeS), "--out", f];
        if (p.comp) args.push("--comp", p.comp);
        if (p.transparent) args.push("--transparent");
        if (p.template) args.push("--template", p.template);
        else if (p.project) args.push("--project", p.project);
        else throw new AdapterError("INVALID_INPUT", "effectcraft.renderFrame needs a project or template file");
        await this.run(args, ctx);
        return { artifacts: [{ file: f, kind: "image", port: "image" }] };
      }
      default:
        throw new AdapterError("UNSUPPORTED", `effectcraft has no operation ${operation}`);
    }
  }
}

/* ------------------------------ AniCraft ------------------------------ */

export class AniCraftAdapter extends CraftAdapter {
  readonly id = "anicraft";
  readonly name = "AniCraft";
  protected readonly exeRel = "AniCraft\\anicraft-cli.exe";

  capabilities() {
    return [
      this.cap("renderSequence", "Render animation", "Render an .anicraft animation to a PNG sequence (then ffmpeg encodes it).", ["anicraft"], ["png"], {
        limitations: ["Requires an existing .anicraft file"],
      }),
      this.cap("gif", "Animated GIF", "Render an .anicraft animation to GIF.", ["anicraft"], ["gif"]),
    ];
  }

  protected async smoke() {
    const res = await runAllowed(this.id, ["info", "--sample"], { timeoutMs: 30_000 });
    return { ok: res.code === 0 && res.stdout.includes("frames"), message: "rendered sample info" };
  }

  async execute(operation: string, params: Record<string, unknown>, ctx: ExecContext): Promise<ExecResult> {
    const p = z.object({ file: z.string(), from: z.number().int().min(1).optional(), to: z.number().int().min(1).optional(), scale: z.number().min(0.1).max(4).optional() }).parse(params);
    const range = [...(p.from ? ["--from", String(p.from)] : []), ...(p.to ? ["--to", String(p.to)] : []), ...(p.scale ? ["--scale", String(p.scale)] : [])];
    switch (operation) {
      case "renderSequence": {
        const dir = path.join(ctx.workDir, "frames");
        fs.mkdirSync(dir, { recursive: true });
        await this.run(["render-seq", p.file, "--out-dir", dir, ...range], ctx);
        const frames = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
        return { artifacts: frames.map((f) => ({ file: path.join(dir, f), kind: "image" as const, port: "frames" })) };
      }
      case "gif": {
        const f = path.join(ctx.workDir, "anim.gif");
        await this.run(["gif", p.file, "--out", f, "--overwrite", "yes", ...range], ctx);
        return { artifacts: [{ file: f, kind: "image", port: "image" }] };
      }
      default:
        throw new AdapterError("UNSUPPORTED", `anicraft has no operation ${operation}`);
    }
  }
}

/* ------------------------------ VectorCraft ------------------------------ */

export class VectorCraftAdapter extends CraftAdapter {
  readonly id = "vectorcraft";
  readonly name = "VectorCraft";
  protected readonly exeRel = "VectorCraft\\vectorcraft-cli.exe";

  capabilities() {
    return [this.cap("rasterize", "Rasterize vector", "Convert SVG/PDF artwork (logos) to PNG at a scale.", ["svg", "pdf"], ["png"])];
  }

  protected async smoke() {
    const res = await runAllowed(this.id, ["--help"], { timeoutMs: 20_000 });
    return { ok: res.code === 0 && /convert/.test(res.stdout), message: "--help lists convert" };
  }

  async execute(operation: string, params: Record<string, unknown>, ctx: ExecContext): Promise<ExecResult> {
    if (operation !== "rasterize") throw new AdapterError("UNSUPPORTED", `vectorcraft has no operation ${operation}`);
    const p = z.object({ input: z.string(), scale: z.number().min(0.1).max(16).default(4) }).parse(params);
    const f = path.join(ctx.workDir, "raster.png");
    await this.run(["convert", p.input, f, "--scale", String(p.scale)], ctx);
    return { artifacts: [{ file: f, kind: "image", port: "image" }] };
  }
}
