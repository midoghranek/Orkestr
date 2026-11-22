import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { allowExecutable, allowedExecutable, runAllowed, runFile, which } from "../util/proc";
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

export interface ProbeStream {
  index: number;
  codec_type: "video" | "audio" | "subtitle" | "data";
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  pix_fmt?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  nb_frames?: string;
}
export interface ProbeResult {
  streams: ProbeStream[];
  format: { format_name: string; duration?: string; size?: string; bit_rate?: string; nb_streams: number };
}

export function parseRate(rate: string | undefined): number | undefined {
  if (!rate) return undefined;
  const [n, d] = rate.split("/").map(Number);
  if (!d) return n || undefined;
  return n / d;
}

const FREE = { model: "free" as const, note: "Local process; no external cost." };

function cap(op: string, label: string, description: string, inF: string[], outF: string[]): CapabilitySpec {
  return {
    id: `ffmpeg.${op}`,
    adapter: "ffmpeg",
    operation: op,
    label,
    description,
    inputFormats: inF,
    outputFormats: outF,
    paid: false,
    cost: FREE,
    verifiedBy: "ffmpeg -version + lavfi smoke render at health check",
  };
}

const CAPS: CapabilitySpec[] = [
  cap("probe", "Probe media", "Read streams, codecs, resolution, fps and duration with ffprobe.", ["video", "audio", "image"], ["json"]),
  cap("encode", "Encode / transcode", "Re-encode video to H.264/AAC MP4 (or VP9 WebM) at a target size and fps.", ["video"], ["mp4", "webm"]),
  cap("concat", "Concatenate", "Join clips end to end (re-encoded, so mixed sources are safe).", ["video"], ["mp4"]),
  cap("mux", "Mux audio + video", "Combine a video with one or more audio tracks (volume, delay, loudness-normalized mix).", ["video", "audio"], ["mp4"]),
  cap("subtitles", "Attach subtitles", "Mux an SRT as a soft subtitle track (mov_text).", ["video", "subtitle"], ["mp4"]),
  cap("frames", "Extract frames", "Extract evenly spaced PNG frames for QA or posters.", ["video"], ["png"]),
  cap("still", "Image to video", "Turn a still image into a video clip with optional slow push-in.", ["image"], ["mp4"]),
  cap("loudnorm", "Normalize loudness", "EBU R128 loudness normalization (two-channel AAC/WAV).", ["audio", "video"], ["wav", "m4a"]),
  cap("loop", "Seamless loop", "Crossfade the tail into the head for a seamless homepage loop; optional muted WebM.", ["video"], ["mp4", "webm"]),
  cap("poster", "Poster frame", "Export a single frame at a timestamp as PNG/JPG.", ["video"], ["png", "jpg"]),
];

export class FfmpegAdapter implements ToolAdapter {
  readonly id = "ffmpeg";
  readonly name = "FFmpeg / FFprobe";
  readonly kind = "local-cli" as const;
  readonly homepage = "https://ffmpeg.org";
  private version?: string;

  async discover(): Promise<Discovery> {
    const ffmpeg = process.env.ORKESTR_FFMPEG ?? which("ffmpeg");
    const ffprobe = process.env.ORKESTR_FFPROBE ?? which("ffprobe");
    if (!ffmpeg || !ffprobe) return { found: false, reason: "ffmpeg/ffprobe not found on PATH" };
    // Chocolatey installs shims; resolve them once so the allowlist holds the real binaries.
    allowExecutable("ffmpeg", ffmpeg);
    allowExecutable("ffprobe", ffprobe);
    const res = await runFile(ffmpeg, ["-hide_banner", "-version"], { timeoutMs: 15_000 });
    const m = /ffmpeg version (\S+)/.exec(res.stdout);
    this.version = m?.[1];
    const encoders = await runFile(ffmpeg, ["-hide_banner", "-encoders"], { timeoutMs: 15_000 });
    const has = (e: string) => new RegExp(`\\s${e}\\s`).test(encoders.stdout);
    return {
      found: res.code === 0,
      version: this.version,
      path: ffmpeg,
      details: {
        ffprobe,
        encoders: { libx264: has("libx264"), aac: has("aac"), libvpx_vp9: has("libvpx-vp9"), libopus: has("libopus") },
      },
    };
  }

  async validateConfig() {
    return { ok: true, issues: [] };
  }

  async healthCheck(): Promise<Health> {
    const t = Date.now();
    const d = await this.discover();
    if (!d.found) return { status: "unavailable", message: d.reason ?? "not found", checkedAt: t, readyCapabilities: [], blocked: {} };
    const res = await runAllowed(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=64x36:rate=10:duration=0.5", "-c:v", "libx264", "-f", "null", "-"],
      { timeoutMs: 30_000 },
    );
    const ok = res.code === 0;
    const enc = (d.details?.encoders ?? {}) as Record<string, boolean>;
    const blocked: Record<string, string> = {};
    if (!enc.libvpx_vp9) blocked["ffmpeg.loop"] = "libvpx-vp9 missing: WebM output disabled (MP4 still works)";
    return {
      status: ok ? "healthy" : "degraded",
      message: ok ? `ffmpeg ${this.version} encoded a lavfi test clip` : `smoke test failed: ${res.stderr.slice(0, 300)}`,
      checkedAt: t,
      latencyMs: Date.now() - t,
      readyCapabilities: ok ? CAPS.map((c) => c.id) : [],
      blocked,
    };
  }

  capabilities(): CapabilitySpec[] {
    return CAPS;
  }

  async estimateCost(): Promise<CostEstimate> {
    return { usd: 0, known: true, basis: "local ffmpeg" };
  }

  async probe(file: string, signal?: AbortSignal): Promise<ProbeResult> {
    if (!allowedExecutable("ffprobe")) await this.discover();
    const res = await runAllowed(
      "ffprobe",
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file],
      { timeoutMs: 60_000, signal },
    );
    if (res.code !== 0) throw new AdapterError("INVALID_INPUT", `ffprobe could not read media: ${res.stderr.slice(0, 400)}`);
    try {
      return JSON.parse(res.stdout) as ProbeResult;
    } catch {
      throw new AdapterError("INVALID_OUTPUT", "ffprobe returned invalid JSON");
    }
  }

  private async ff(args: string[], ctx: ExecContext, expectedDurationS?: number): Promise<void> {
    if (!allowedExecutable("ffmpeg")) await this.discover();
    checkAborted(ctx.signal);
    let buf = "";
    const res = await runAllowed("ffmpeg", ["-hide_banner", "-y", "-nostdin", "-progress", "pipe:1", "-loglevel", "error", ...args], {
      signal: ctx.signal,
      timeoutMs: 60 * 60_000,
      onStdout: (c) => {
        buf += c;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        for (const l of lines) {
          const m = /^out_time_us=(\d+)/.exec(l);
          if (m && expectedDurationS) ctx.progress(Math.min(0.99, Number(m[1]) / 1e6 / expectedDurationS));
        }
      },
    });
    if (res.aborted) throw new AdapterError("CANCELLED", "ffmpeg cancelled");
    if (res.timedOut) throw new AdapterError("TIMEOUT", "ffmpeg timed out");
    if (res.code !== 0) throw new AdapterError("TOOL_FAILED", `ffmpeg exited ${res.code}: ${res.stderr.slice(-800)}`);
  }

  private async duration(file: string, signal: AbortSignal): Promise<number> {
    const p = await this.probe(file, signal);
    return Number(p.format.duration ?? 0);
  }

  async execute(operation: string, params: Record<string, unknown>, ctx: ExecContext): Promise<ExecResult> {
    const out = (name: string) => path.join(ctx.workDir, name);
    switch (operation) {
      case "probe": {
        const { input } = z.object({ input: z.string() }).parse(params);
        const p = await this.probe(input, ctx.signal);
        const f = out("probe.json");
        fs.writeFileSync(f, JSON.stringify(p, null, 2));
        return { artifacts: [{ file: f, kind: "json", port: "probe" }], values: { probe: p } };
      }
      case "encode": {
        const p = z
          .object({
            input: z.string(),
            width: z.number().int().min(16).max(7680).optional(),
            height: z.number().int().min(16).max(7680).optional(),
            fps: z.number().min(1).max(120).optional(),
            crf: z.number().int().min(0).max(51).default(20),
            format: z.enum(["mp4", "webm"]).default("mp4"),
            audio: z.boolean().default(true),
            maxBitrateK: z.number().int().optional(),
          })
          .parse(params);
        const dur = await this.duration(p.input, ctx.signal);
        const vf: string[] = [];
        if (p.width && p.height)
          vf.push(`scale=${p.width}:${p.height}:force_original_aspect_ratio=decrease`, `pad=${p.width}:${p.height}:(ow-iw)/2:(oh-ih)/2:color=black`, "setsar=1");
        if (p.fps) vf.push(`fps=${p.fps}`);
        const f = out(`encoded.${p.format}`);
        const v =
          p.format === "mp4"
            ? ["-c:v", "libx264", "-preset", "slow", "-crf", String(p.crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", ...(p.maxBitrateK ? ["-maxrate", `${p.maxBitrateK}k`, "-bufsize", `${p.maxBitrateK * 2}k`] : [])]
            : ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(Math.max(p.crf, 30)), "-row-mt", "1"];
        const a = !p.audio ? ["-an"] : p.format === "mp4" ? ["-c:a", "aac", "-b:a", "192k"] : ["-c:a", "libopus", "-b:a", "128k"];
        await this.ff(["-i", p.input, ...(vf.length ? ["-vf", vf.join(",")] : []), ...v, ...a, f], ctx, dur);
        return { artifacts: [{ file: f, kind: "video", port: "video" }] };
      }
      case "concat": {
        const p = z.object({ inputs: z.array(z.string()).min(1).max(100), width: z.number().int(), height: z.number().int(), fps: z.number().default(30) }).parse(params);
        let total = 0;
        const hasAudio: boolean[] = [];
        for (const i of p.inputs) {
          const pr = await this.probe(i, ctx.signal);
          total += Number(pr.format.duration ?? 0);
          hasAudio.push(pr.streams.some((s) => s.codec_type === "audio"));
        }
        const args: string[] = [];
        p.inputs.forEach((i) => args.push("-i", i));
        // Silent audio source for clips without audio, so concat always has a=1.
        args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
        const silent = p.inputs.length;
        // Clips without audio get a slice of anullsrc of their own length, so concat always has a=1.
        const filter: string[] = [];
        const silentCount = hasAudio.filter((h) => !h).length;
        if (silentCount > 1) filter.push(`[${silent}:a]asplit=${silentCount}${hasAudio.map((h, i) => (h ? "" : `[s${i}]`)).join("")}`);
        for (let idx = 0; idx < p.inputs.length; idx++) {
          filter.push(`[${idx}:v]scale=${p.width}:${p.height}:force_original_aspect_ratio=decrease,pad=${p.width}:${p.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${p.fps},format=yuv420p[v${idx}]`);
          if (hasAudio[idx]) filter.push(`[${idx}:a]aresample=48000,aformat=channel_layouts=stereo[a${idx}]`);
          else {
            const d = Number((await this.probe(p.inputs[idx], ctx.signal)).format.duration ?? 0);
            const src = silentCount > 1 ? `[s${idx}]` : `[${silent}:a]`;
            filter.push(`${src}atrim=0:${d.toFixed(3)},asetpts=N/SR/TB[a${idx}]`);
          }
        }
        filter.push(`${p.inputs.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${p.inputs.length}:v=1:a=1[v][a]`);
        const f = out("concat.mp4");
        await this.ff([...args, "-filter_complex", filter.join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", f], ctx, total);
        return { artifacts: [{ file: f, kind: "video", port: "video" }] };
      }
      case "mux": {
        const p = z
          .object({
            video: z.string(),
            tracks: z.array(z.object({ path: z.string(), volume: z.number().min(0).max(4).default(1), delayS: z.number().min(0).default(0) })).max(16),
            keepVideoAudio: z.boolean().default(false),
            loudnorm: z.boolean().default(true),
          })
          .parse(params);
        const dur = await this.duration(p.video, ctx.signal);
        const args = ["-i", p.video];
        p.tracks.forEach((t) => args.push("-i", t.path));
        const filter: string[] = [];
        const labels: string[] = [];
        if (p.keepVideoAudio) {
          const pr = await this.probe(p.video, ctx.signal);
          if (pr.streams.some((s) => s.codec_type === "audio")) {
            filter.push(`[0:a]aresample=48000[a0]`);
            labels.push("[a0]");
          }
        }
        p.tracks.forEach((t, i) => {
          const ms = Math.round(t.delayS * 1000);
          filter.push(`[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${t.volume},adelay=${ms}|${ms}[t${i}]`);
          labels.push(`[t${i}]`);
        });
        const f = out("mux.mp4");
        if (labels.length === 0) {
          await this.ff(["-i", p.video, "-c", "copy", "-an", f], ctx, dur);
        } else {
          const mix = `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0${p.loudnorm ? ",loudnorm=I=-16:TP=-1.5:LRA=11" : ""},atrim=0:${dur.toFixed(3)}[mix]`;
          filter.push(mix);
          await this.ff([...args, "-filter_complex", filter.join(";"), "-map", "0:v", "-map", "[mix]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", f], ctx, dur);
        }
        return { artifacts: [{ file: f, kind: "video", port: "video" }] };
      }
      case "subtitles": {
        const p = z.object({ video: z.string(), srt: z.string(), language: z.string().regex(/^[a-z]{3}$/).default("ara") }).parse(params);
        const f = out("subtitled.mp4");
        await this.ff(["-i", p.video, "-i", p.srt, "-map", "0", "-map", "1", "-c", "copy", "-c:s", "mov_text", `-metadata:s:s:0`, `language=${p.language}`, f], ctx);
        return { artifacts: [{ file: f, kind: "video", port: "video" }] };
      }
      case "frames": {
        const p = z.object({ input: z.string(), count: z.number().int().min(1).max(48).default(6) }).parse(params);
        const dur = await this.duration(p.input, ctx.signal);
        const artifacts = [];
        for (let i = 0; i < p.count; i++) {
          const t = (dur * (i + 0.5)) / p.count;
          const f = out(`frame-${String(i + 1).padStart(2, "0")}.png`);
          await this.ff(["-ss", t.toFixed(3), "-i", p.input, "-frames:v", "1", f], ctx);
          artifacts.push({ file: f, kind: "image" as const, port: "frames", metadata: { timeS: t } });
          ctx.progress((i + 1) / p.count);
        }
        return { artifacts };
      }
      case "still": {
        const p = z
          .object({ image: z.string(), durationS: z.number().min(0.2).max(120), width: z.number().int(), height: z.number().int(), fps: z.number().default(30), pushIn: z.boolean().default(true) })
          .parse(params);
        const frames = Math.round(p.durationS * p.fps);
        const vf = p.pushIn
          ? `scale=${p.width * 2}:${p.height * 2}:force_original_aspect_ratio=increase,crop=${p.width * 2}:${p.height * 2},zoompan=z='min(1+0.0008*on,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${p.width}x${p.height}:fps=${p.fps},format=yuv420p`
          : `scale=${p.width}:${p.height}:force_original_aspect_ratio=increase,crop=${p.width}:${p.height},fps=${p.fps},format=yuv420p`;
        const f = out("still.mp4");
        await this.ff(["-loop", "1", "-i", p.image, "-t", p.durationS.toFixed(3), "-vf", vf, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", f], ctx, p.durationS);
        return { artifacts: [{ file: f, kind: "video", port: "video" }] };
      }
      case "loudnorm": {
        const p = z.object({ input: z.string(), format: z.enum(["wav", "m4a"]).default("m4a") }).parse(params);
        const f = out(`normalized.${p.format}`);
        await this.ff(["-i", p.input, "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-ac", "2", ...(p.format === "m4a" ? ["-c:a", "aac", "-b:a", "192k"] : []), f], ctx);
        return { artifacts: [{ file: f, kind: "audio", port: "audio" }] };
      }
      case "loop": {
        const p = z.object({ input: z.string(), crossfadeS: z.number().min(0.1).max(5).default(1), webm: z.boolean().default(true) }).parse(params);
        const dur = await this.duration(p.input, ctx.signal);
        if (dur <= p.crossfadeS * 2) throw new AdapterError("INVALID_INPUT", "clip too short for a crossfade loop");
        const xf = p.crossfadeS;
        // Output length = dur - xf. Tail [dur-xf, dur] fades over head [0, xf].
        const filter = `[0:v]split[a][b];[a]trim=start=${xf},setpts=PTS-STARTPTS[body];[b]trim=0:${xf},setpts=PTS-STARTPTS[head];[body][head]xfade=transition=fade:duration=${xf}:offset=${(dur - 2 * xf).toFixed(3)},format=yuv420p[v]`;
        const mp4 = out("loop.mp4");
        await this.ff(["-i", p.input, "-filter_complex", filter, "-map", "[v]", "-an", "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], ctx, dur);
        const artifacts: ExecResult["artifacts"] = [{ file: mp4, kind: "video", port: "video", label: "loop (mp4, muted)" }];
        if (p.webm) {
          const webm = out("loop.webm");
          await this.ff(["-i", mp4, "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-row-mt", "1", webm], ctx, dur);
          artifacts.push({ file: webm, kind: "video", port: "webm", label: "loop (webm, muted)" });
        }
        return { artifacts };
      }
      case "poster": {
        const p = z.object({ input: z.string(), timeS: z.number().min(0).default(0), format: z.enum(["png", "jpg"]).default("jpg") }).parse(params);
        const f = out(`poster.${p.format}`);
        await this.ff(["-ss", p.timeS.toFixed(3), "-i", p.input, "-frames:v", "1", ...(p.format === "jpg" ? ["-q:v", "2"] : []), f], ctx);
        return { artifacts: [{ file: f, kind: "image", port: "image" }] };
      }
      default:
        throw new AdapterError("UNSUPPORTED", `ffmpeg has no operation ${operation}`);
    }
  }
}
