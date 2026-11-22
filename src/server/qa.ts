import fs from "node:fs";
import { FfmpegAdapter, parseRate } from "./adapters/ffmpeg";
import { parseSrt } from "./adapters/whisper";
import { allowedExecutable, runAllowed } from "./util/proc";

export interface QaCheck {
  name: string;
  pass: boolean;
  expected?: string;
  actual: string;
  severity: "critical" | "major" | "minor";
}

export interface QaReport {
  file: string;
  pass: boolean;
  checks: QaCheck[];
  facts: {
    width?: number;
    height?: number;
    aspect?: string;
    fps?: number;
    durationS?: number;
    videoCodec?: string;
    pixFmt?: string;
    audioStreams: number;
    audioCodec?: string;
    sampleRate?: string;
    channels?: number;
    sizeBytes: number;
    bitrateKbps?: number;
    integratedLufs?: number;
    truePeakDb?: number;
    blackFrames?: number;
    subtitleCues?: number;
  };
  checkedAt: string;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

const ffmpeg = new FfmpegAdapter();

/** Loudness (EBU R128) + black-frame scan via ffmpeg filters. */
async function signalStats(file: string, hasAudio: boolean, signal?: AbortSignal) {
  if (!allowedExecutable("ffmpeg")) await ffmpeg.discover();
  const args = ["-hide_banner", "-nostats", "-i", file, "-vf", "blackdetect=d=0.5:pix_th=0.06"];
  if (hasAudio) args.push("-af", "ebur128=peak=true");
  args.push("-f", "null", "-");
  const r = await runAllowed("ffmpeg", args, { signal, timeoutMs: 20 * 60_000 });
  const text = r.stderr;
  const lufs = /I:\s+(-?[\d.]+) LUFS(?![\s\S]*I:\s+-?[\d.]+ LUFS)/.exec(text);
  const peak = /Peak:\s+(-?[\d.]+) dBFS(?![\s\S]*Peak:)/.exec(text);
  const blacks = (text.match(/black_start/g) ?? []).length;
  return { lufs: lufs ? Number(lufs[1]) : undefined, peak: peak ? Number(peak[1]) : undefined, blacks };
}

export async function technicalQa(
  file: string,
  expect: { expectWidth?: number; expectHeight?: number; expectFps?: number; minDurationS?: number; maxDurationS?: number; requireAudio?: boolean; maxBytes?: number },
  signal?: AbortSignal,
  srtPath?: string,
): Promise<QaReport> {
  const checks: QaCheck[] = [];
  const size = fs.statSync(file).size;
  let p;
  try {
    p = await ffmpeg.probe(file, signal);
  } catch (e) {
    return { file, pass: false, checks: [{ name: "readable", pass: false, actual: (e as Error).message, severity: "critical" }], facts: { audioStreams: 0, sizeBytes: size }, checkedAt: new Date().toISOString() };
  }
  const v = p.streams.find((s) => s.codec_type === "video");
  const audio = p.streams.filter((s) => s.codec_type === "audio");
  const a = audio[0];
  const fps = parseRate(v?.avg_frame_rate ?? v?.r_frame_rate);
  const dur = Number(p.format.duration ?? v?.duration ?? 0);
  const g = v?.width && v?.height ? gcd(v.width, v.height) : 1;
  const facts: QaReport["facts"] = {
    width: v?.width,
    height: v?.height,
    aspect: v?.width && v?.height ? `${v.width / g}:${v.height / g}` : undefined,
    fps: fps ? Math.round(fps * 1000) / 1000 : undefined,
    durationS: Math.round(dur * 1000) / 1000,
    videoCodec: v?.codec_name,
    pixFmt: v?.pix_fmt,
    audioStreams: audio.length,
    audioCodec: a?.codec_name,
    sampleRate: a?.sample_rate,
    channels: a?.channels,
    sizeBytes: size,
    bitrateKbps: p.format.bit_rate ? Math.round(Number(p.format.bit_rate) / 1000) : undefined,
  };
  checks.push({ name: "video stream", pass: !!v, actual: v ? `${v.codec_name} ${v.width}x${v.height}` : "none", severity: "critical" });
  if (expect.expectWidth || expect.expectHeight)
    checks.push({ name: "resolution", pass: v?.width === expect.expectWidth && v?.height === expect.expectHeight, expected: `${expect.expectWidth}x${expect.expectHeight}`, actual: `${v?.width}x${v?.height}`, severity: "critical" });
  if (expect.expectFps) checks.push({ name: "frame rate", pass: !!fps && Math.abs(fps - expect.expectFps) < 0.01, expected: String(expect.expectFps), actual: String(facts.fps), severity: "major" });
  if (expect.minDurationS !== undefined || expect.maxDurationS !== undefined) {
    const ok = (expect.minDurationS === undefined || dur >= expect.minDurationS - 0.05) && (expect.maxDurationS === undefined || dur <= expect.maxDurationS + 0.05);
    checks.push({ name: "duration", pass: ok, expected: `${expect.minDurationS ?? 0}–${expect.maxDurationS ?? "∞"}s`, actual: `${facts.durationS}s`, severity: "critical" });
  }
  if (expect.requireAudio !== false) checks.push({ name: "audio stream", pass: audio.length > 0, expected: "≥1", actual: String(audio.length), severity: "critical" });
  checks.push({ name: "web-safe pixel format", pass: !v || v.pix_fmt === "yuv420p", expected: "yuv420p", actual: String(v?.pix_fmt), severity: "major" });
  if (v?.codec_name) checks.push({ name: "codec", pass: ["h264", "vp9", "hevc", "av1"].includes(v.codec_name), expected: "h264/vp9", actual: v.codec_name, severity: "major" });
  if (expect.maxBytes) checks.push({ name: "file size", pass: size <= expect.maxBytes, expected: `≤${expect.maxBytes}`, actual: String(size), severity: "minor" });

  const stats = await signalStats(file, audio.length > 0, signal).catch(() => ({ lufs: undefined, peak: undefined, blacks: 0 }));
  facts.integratedLufs = stats.lufs;
  facts.truePeakDb = stats.peak;
  facts.blackFrames = stats.blacks;
  if (audio.length && stats.lufs !== undefined) checks.push({ name: "loudness", pass: stats.lufs >= -20 && stats.lufs <= -12, expected: "-20…-12 LUFS (target -16)", actual: `${stats.lufs} LUFS`, severity: "minor" });
  if (audio.length && stats.peak !== undefined) checks.push({ name: "true peak", pass: stats.peak <= -0.5, expected: "≤ -0.5 dBFS", actual: `${stats.peak} dBFS`, severity: "minor" });
  checks.push({ name: "unexpected black segments (≥0.5s)", pass: stats.blacks === 0, expected: "0", actual: String(stats.blacks), severity: "major" });

  if (srtPath) {
    try {
      const cues = parseSrt(fs.readFileSync(srtPath, "utf8"));
      facts.subtitleCues = cues.length;
      const overlaps = cues.filter((c, i) => i > 0 && c.startMs < cues[i - 1].endMs).length;
      const beyond = cues.filter((c) => c.endMs > dur * 1000 + 100).length;
      const long = cues.filter((c) => c.text.length > 84).length;
      checks.push({ name: "subtitles parse", pass: cues.length > 0, actual: `${cues.length} cues`, severity: "major" });
      checks.push({ name: "subtitle overlaps", pass: overlaps === 0, expected: "0", actual: String(overlaps), severity: "minor" });
      checks.push({ name: "subtitles within duration", pass: beyond === 0, expected: "0 beyond end", actual: String(beyond), severity: "major" });
      checks.push({ name: "subtitle line length", pass: long === 0, expected: "≤84 chars/cue", actual: `${long} long cues`, severity: "minor" });
    } catch (e) {
      checks.push({ name: "subtitles parse", pass: false, actual: (e as Error).message, severity: "major" });
    }
  }
  const pass = checks.every((c) => c.pass || c.severity === "minor");
  return { file, pass, checks, facts, checkedAt: new Date().toISOString() };
}
