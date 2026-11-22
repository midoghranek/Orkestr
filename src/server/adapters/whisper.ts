import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { allowExecutable, allowedExecutable, runAllowed, runFile } from "../util/proc";
import { dataDir } from "../util/paths";
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
 * Local speech-to-text with whisper.cpp (v1.5.5 Windows x64 build, installed by Orkestr into data/tools).
 * Models are ggml files from huggingface.co/ggerganov/whisper.cpp. No network at transcription time.
 */
export const WHISPER_VERSION = "1.5.5";
export const WHISPER_MODELS = ["tiny", "base", "small", "medium"] as const;
const MODEL_DTW: Record<string, string> = { tiny: "tiny", base: "base", small: "small", medium: "medium" };

export function whisperDir(): string {
  return process.env.ORKESTR_WHISPER_DIR ?? path.join(dataDir(), "tools", "whisper.cpp");
}

export function installedModels(): string[] {
  const dir = whisperDir();
  return WHISPER_MODELS.filter((m) => fs.existsSync(path.join(dir, `ggml-${m}.bin`)));
}

export interface Caption {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number | null;
}

interface WhisperJson {
  result: { language: string };
  transcription: {
    offsets: { from: number; to: number };
    text: string;
    tokens?: { text: string; offsets: { from: number; to: number }; p: number; t_dtw: number }[];
  }[];
}

/** Word-level captions from whisper.cpp full JSON (tokens merged into words at leading spaces). */
export function toWordCaptions(json: WhisperJson): Caption[] {
  const words: Caption[] = [];
  for (const seg of json.transcription) {
    const tokens = (seg.tokens ?? []).filter((t) => !/^\[_|^\[/.test(t.text));
    if (tokens.length === 0) {
      if (seg.text.trim()) words.push({ text: seg.text.trim(), startMs: seg.offsets.from, endMs: seg.offsets.to, confidence: null });
      continue;
    }
    for (const t of tokens) {
      const startsWord = t.text.startsWith(" ") || words.length === 0;
      const prev = words[words.length - 1];
      if (startsWord || !prev || prev.endMs < seg.offsets.from) {
        words.push({ text: t.text.trim(), startMs: t.offsets.from, endMs: t.offsets.to, confidence: t.p });
      } else {
        prev.text += t.text;
        prev.endMs = t.offsets.to;
        prev.confidence = prev.confidence === null ? t.p : Math.min(prev.confidence, t.p);
      }
    }
  }
  return words.filter((w) => w.text.length > 0);
}

/** Group words into subtitle cues: max chars per cue, max duration, break on sentence punctuation. */
export function groupCues(words: Caption[], maxChars = 42, maxMs = 4500): Caption[] {
  const cues: Caption[] = [];
  let cur: Caption | null = null;
  for (const w of words) {
    if (cur && (cur.text.length + 1 + w.text.length > maxChars || w.endMs - cur.startMs > maxMs)) {
      cues.push(cur);
      cur = null;
    }
    if (!cur) cur = { ...w };
    else {
      cur.text = `${cur.text} ${w.text}`;
      cur.endMs = w.endMs;
      cur.confidence = cur.confidence === null || w.confidence === null ? null : Math.min(cur.confidence, w.confidence);
    }
    if (/[.!?؟،۔]$/.test(w.text)) {
      cues.push(cur);
      cur = null;
    }
  }
  if (cur) cues.push(cur);
  return cues;
}

function ts(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = Math.floor(ms % 1000);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function toSrt(cues: Caption[]): string {
  return cues.map((c, i) => `${i + 1}\n${ts(c.startMs)} --> ${ts(Math.max(c.endMs, c.startMs + 300))}\n${c.text}\n`).join("\n");
}

export function parseSrt(text: string): Caption[] {
  const blocks = text.replace(/\r/g, "").trim().split(/\n\s*\n/);
  const toMs = (t: string) => {
    const m = /(\d+):(\d+):(\d+)[,.](\d+)/.exec(t);
    if (!m) throw new AdapterError("INVALID_INPUT", `bad SRT timestamp: ${t}`);
    return Number(m[1]) * 3_600_000 + Number(m[2]) * 60_000 + Number(m[3]) * 1000 + Number(m[4].padEnd(3, "0").slice(0, 3));
  };
  return blocks.map((b) => {
    const lines = b.split("\n");
    const timeLine = lines.find((l) => l.includes("-->"));
    if (!timeLine) throw new AdapterError("INVALID_INPUT", "SRT cue without timing line");
    const [a, z2] = timeLine.split("-->").map((s) => s.trim());
    const text = lines.slice(lines.indexOf(timeLine) + 1).join("\n").trim();
    return { text, startMs: toMs(a), endMs: toMs(z2), confidence: null };
  });
}

export class WhisperAdapter implements ToolAdapter {
  readonly id = "whisper";
  readonly name = "Whisper (whisper.cpp)";
  readonly kind = "local-cli" as const;
  readonly homepage = "https://github.com/ggerganov/whisper.cpp";

  private exe(): string {
    return path.join(whisperDir(), "main.exe");
  }

  async discover(): Promise<Discovery> {
    const exe = this.exe();
    if (!fs.existsSync(exe)) return { found: false, reason: `whisper.cpp not installed at ${whisperDir()} (Settings → Tools → Install Whisper)` };
    allowExecutable("whisper", exe);
    return { found: true, version: WHISPER_VERSION, path: exe, details: { models: installedModels() } };
  }

  async validateConfig() {
    const models = installedModels();
    return { ok: models.length > 0, issues: models.length ? [] : ["no ggml model downloaded"] };
  }

  async healthCheck(): Promise<Health> {
    const t = Date.now();
    const d = await this.discover();
    if (!d.found) return { status: "unavailable", message: d.reason ?? "missing", checkedAt: t, readyCapabilities: [], blocked: {} };
    const models = installedModels();
    const res = await runFile(this.exe(), ["--help"], { timeoutMs: 20_000, cwd: whisperDir() });
    const ok = /usage/i.test(res.stdout + res.stderr);
    if (!models.length)
      return { status: "degraded", message: "whisper.cpp present but no model downloaded", checkedAt: t, readyCapabilities: [], blocked: { "whisper.transcribe": "download a model first" } };
    return {
      status: ok ? "healthy" : "degraded",
      message: ok ? `whisper.cpp ${WHISPER_VERSION}; models: ${models.join(", ")}` : "main.exe --help failed",
      checkedAt: t,
      latencyMs: Date.now() - t,
      readyCapabilities: ok ? ["whisper.transcribe"] : [],
      blocked: {},
    };
  }

  capabilities(): CapabilitySpec[] {
    return [
      {
        id: "whisper.transcribe",
        adapter: "whisper",
        operation: "transcribe",
        label: "Transcribe + captions",
        description: "Local multilingual speech-to-text with word timestamps; outputs SRT cues and word JSON.",
        inputFormats: ["wav", "mp3", "m4a", "mp4"],
        outputFormats: ["srt", "json"],
        paid: false,
        cost: { model: "free", note: "Runs on the local CPU." },
        verifiedBy: "Phase 0: installed v1.5.5, downloaded ggml-base, transcribed a FilmCraft TTS clip",
        requires: ["ffmpeg (16 kHz mono conversion)"],
        limitations: [
          "base model is weak on Arabic dialects; download small/medium for Egyptian Arabic",
          "captions always need human review before publishing",
        ],
      },
    ];
  }

  async estimateCost(): Promise<CostEstimate> {
    return { usd: 0, known: true, basis: "local whisper.cpp" };
  }

  async execute(operation: string, params: Record<string, unknown>, ctx: ExecContext): Promise<ExecResult> {
    if (operation !== "transcribe") throw new AdapterError("UNSUPPORTED", `whisper has no operation ${operation}`);
    const p = z
      .object({
        input: z.string(),
        language: z.string().regex(/^(auto|[a-z]{2})$/).default("auto"),
        model: z.enum(WHISPER_MODELS).optional(),
        maxChars: z.number().int().min(10).max(80).default(42),
        prompt: z.string().max(400).optional(),
      })
      .parse(params);
    if (!allowedExecutable("whisper")) await this.discover();
    if (!allowedExecutable("ffmpeg")) throw new AdapterError("NOT_AVAILABLE", "ffmpeg is required to prepare audio for whisper");
    const models = installedModels();
    const model = p.model ?? (models.includes("small") ? "small" : models[0]);
    if (!model || !models.includes(model)) throw new AdapterError("NOT_CONFIGURED", `whisper model ${p.model ?? "(any)"} not downloaded`);
    const wav = path.join(ctx.workDir, "speech16k.wav");
    const conv = await runAllowed("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", p.input, "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], { signal: ctx.signal, timeoutMs: 10 * 60_000 });
    if (conv.code !== 0) throw new AdapterError("INVALID_INPUT", `could not decode audio: ${conv.stderr.slice(0, 300)}`);
    checkAborted(ctx.signal);
    const outBase = path.join(ctx.workDir, "whisper");
    const args = ["-f", wav, "--output-file", outBase, "--output-json", "-ojf", "--dtw", MODEL_DTW[model], "-m", path.join(whisperDir(), `ggml-${model}.bin`), "-pp", "-l", p.language];
    if (p.prompt) args.push("--prompt", p.prompt);
    const res = await runAllowed("whisper", args, {
      cwd: whisperDir(),
      signal: ctx.signal,
      timeoutMs: 60 * 60_000,
      onStderr: (c) => {
        const m = /progress =\s*(\d+)/.exec(c);
        if (m) ctx.progress(Number(m[1]) / 100, "transcribing");
      },
    });
    if (res.aborted) throw new AdapterError("CANCELLED", "transcription cancelled");
    const jsonPath = `${outBase}.json`;
    if (res.code !== 0 || !fs.existsSync(jsonPath)) throw new AdapterError("TOOL_FAILED", `whisper failed (${res.code}): ${res.stderr.slice(-500)}`);
    const json = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as WhisperJson;
    const words = toWordCaptions(json);
    const cues = groupCues(words, p.maxChars);
    const srtPath = path.join(ctx.workDir, "captions.srt");
    fs.writeFileSync(srtPath, toSrt(cues), "utf8");
    const wordsPath = path.join(ctx.workDir, "words.json");
    fs.writeFileSync(wordsPath, JSON.stringify({ language: json.result.language, model, words, cues }, null, 2));
    const lowConfidence = words.filter((w) => w.confidence !== null && w.confidence < 0.5).length;
    ctx.log(lowConfidence ? "warn" : "info", `transcribed ${words.length} words (${json.result.language}, ${model}); ${lowConfidence} low-confidence words need review`);
    return {
      artifacts: [
        { file: srtPath, kind: "subtitle", port: "subtitles", label: `captions (${json.result.language}, ${model}) — review required` },
        { file: wordsPath, kind: "json", port: "words" },
      ],
      values: { language: json.result.language, words: words.length, lowConfidence, text: words.map((w) => w.text).join(" ") },
    };
  }
}

/** Install whisper.cpp + a model (free downloads). Used by Settings; never run implicitly by a workflow. */
export async function installWhisper(model: (typeof WHISPER_MODELS)[number] = "base", onProgress?: (msg: string) => void): Promise<void> {
  const dir = whisperDir();
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, "main.exe"))) {
    if (process.platform !== "win32") throw new AdapterError("UNSUPPORTED", "automatic install is implemented for Windows; build whisper.cpp and set ORKESTR_WHISPER_DIR");
    // Same archive @remotion/install-whisper-cpp uses for 1.5.5 on Windows.
    const url = "https://remotion-ffmpeg-binaries.s3.eu-central-1.amazonaws.com/whisper-bin-x64-1-5-5.zip";
    onProgress?.(`downloading ${url}`);
    const r = await fetch(url);
    if (!r.ok) throw new AdapterError("PROVIDER", `download failed: HTTP ${r.status}`);
    const zip = path.join(dir, "whisper-bin-x64.zip");
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    const tar = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    const x = await runFile(tar, ["-xf", zip, "-C", dir], { timeoutMs: 120_000 });
    fs.rmSync(zip, { force: true });
    if (x.code !== 0) throw new AdapterError("TOOL_FAILED", `extract failed: ${x.stderr}`);
  }
  const modelPath = path.join(dir, `ggml-${model}.bin`);
  if (!fs.existsSync(modelPath)) {
    const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin`;
    onProgress?.(`downloading ${url}`);
    const r = await fetch(url);
    if (!r.ok || !r.body) throw new AdapterError("PROVIDER", `model download failed: HTTP ${r.status}`);
    const tmp = `${modelPath}.part`;
    const ws = fs.createWriteStream(tmp);
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!ws.write(value)) await new Promise<void>((res) => ws.once("drain", () => res()));
    }
    await new Promise<void>((res, rej) => ws.end((err?: Error | null) => (err ? rej(err) : res())));
    fs.renameSync(tmp, modelPath);
  }
}
