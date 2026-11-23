import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { z } from "zod";
import { ROOT_DIR, dataDir } from "../util/paths";
import { sha256 } from "../util/ids";
import { EphemeralFileServer } from "../util/fileserver";
import { allowedExecutable, runAllowed } from "../util/proc";
import { FfmpegAdapter } from "./ffmpeg";
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

const require = createRequire(import.meta.url);

export const REMOTION_DIR = path.join(ROOT_DIR, "remotion");
export const COMPOSITIONS = ["Commercial", "Poster", "Loop", "TestCard"] as const;

/** Hash of every source file under remotion/ — the bundle is rebuilt only when compositions change. */
export function sourceHash(): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== ".cache" && e.name !== "node_modules") walk(p);
      } else parts.push(`${path.relative(REMOTION_DIR, p)}:${fs.statSync(p).size}:${sha256(fs.readFileSync(p))}`);
    }
  };
  walk(REMOTION_DIR);
  return sha256(parts.join("\n")).slice(0, 16);
}

let bundlePromise: { hash: string; promise: Promise<string> } | undefined;

export async function getBundle(log?: ExecContext["log"]): Promise<string> {
  const hash = sourceHash();
  if (bundlePromise?.hash === hash) return bundlePromise.promise;
  const outDir = path.join(dataDir(), "remotion-bundle", hash);
  const promise = (async () => {
    if (fs.existsSync(path.join(outDir, "index.html"))) return outDir;
    log?.("info", `bundling Remotion compositions (${hash})`);
    const { bundle } = (await import("@remotion/bundler")) as typeof import("@remotion/bundler");
    return bundle({
      entryPoint: path.join(REMOTION_DIR, "index.ts"),
      outDir,
      publicDir: path.join(REMOTION_DIR, "public"),
      onProgress: () => undefined,
    });
  })();
  bundlePromise = { hash, promise };
  promise.catch(() => {
    if (bundlePromise?.promise === promise) bundlePromise = undefined;
  });
  return promise;
}

export const FILE_PREFIX = "orkestr-file:";
/** Mark a local file for a render prop. Plain strings keep the props schema-valid. */
export const fileRef = (p: string) => `${FILE_PREFIX}${p}`;

/** Replace `orkestr-file:<abs path>` strings (or legacy `{"$file"}` objects) with loopback URLs served for the duration of the render. */
export function bindFiles(value: unknown, server: EphemeralFileServer): unknown {
  if (typeof value === "string" && value.startsWith(FILE_PREFIX)) {
    const p = value.slice(FILE_PREFIX.length);
    if (!fs.existsSync(p)) throw new AdapterError("INVALID_INPUT", `render input missing: ${p}`);
    return server.url(p);
  }
  if (Array.isArray(value)) return value.map((v) => bindFiles(v, server));
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.$file === "string" && Object.keys(o).length === 1) {
      if (!fs.existsSync(o.$file)) throw new AdapterError("INVALID_INPUT", `render input missing: ${o.$file}`);
      return server.url(o.$file);
    }
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, bindFiles(v, server)]));
  }
  return value;
}

async function toWebSafe(file: string, ctx: ExecContext): Promise<string> {
  const ff = new FfmpegAdapter();
  if (!allowedExecutable("ffmpeg")) await ff.discover();
  const probe = await ff.probe(file, ctx.signal);
  const v = probe.streams.find((s) => s.codec_type === "video");
  if (v?.pix_fmt === "yuv420p") return file;
  const out = file.replace(/.mp4$/, ".web.mp4");
  const r = await runAllowed("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", file, "-vf", "scale=in_range=full:out_range=tv,format=yuv420p", "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-c:v", "libx264", "-crf", "17", "-preset", "slow", "-c:a", "copy", "-movflags", "+faststart", out], { signal: ctx.signal, timeoutMs: 30 * 60_000 });
  if (r.code !== 0) throw new AdapterError("TOOL_FAILED", `pixel-format pass failed: ${r.stderr.slice(-400)}`);
  fs.rmSync(file, { force: true });
  return out;
}

const FREE = { model: "free" as const, note: "Local render; Remotion licence terms apply to companies (see remotion.dev/license)." };

export class RemotionAdapter implements ToolAdapter {
  readonly id = "remotion";
  readonly name = "Remotion";
  readonly kind = "library" as const;
  readonly homepage = "https://www.remotion.dev";

  async discover(): Promise<Discovery> {
    try {
      const pkg = require("@remotion/renderer/package.json") as { version: string };
      const entry = path.join(REMOTION_DIR, "index.ts");
      return { found: fs.existsSync(entry), version: pkg.version, path: entry, reason: fs.existsSync(entry) ? undefined : "remotion/index.ts missing" };
    } catch {
      return { found: false, reason: "@remotion/renderer not installed" };
    }
  }

  async validateConfig() {
    return { ok: true, issues: [] };
  }

  async healthCheck(): Promise<Health> {
    const t = Date.now();
    const d = await this.discover();
    if (!d.found) return { status: "unavailable", message: d.reason ?? "missing", checkedAt: t, readyCapabilities: [], blocked: {} };
    // No browser download here: Chrome Headless Shell is fetched (free) on the first render.
    return {
      status: "healthy",
      message: `Remotion ${d.version}; compositions: ${COMPOSITIONS.join(", ")}. Chrome Headless Shell is fetched on first render if missing.`,
      checkedAt: t,
      latencyMs: Date.now() - t,
      readyCapabilities: this.capabilities().map((c) => c.id),
      blocked: {},
    };
  }

  capabilities(): CapabilitySpec[] {
    const base = { adapter: "remotion", paid: false, cost: FREE, verifiedBy: "@remotion/renderer installed; TestCard smoke render in integration tests" };
    return [
      { ...base, id: "remotion.render", operation: "render", label: "Render composition", description: "Render a React/Remotion composition (Commercial, Loop, TestCard) to H.264 MP4 with captions, brand overlays and audio.", inputFormats: ["json", "image", "video", "audio"], outputFormats: ["mp4"] },
      { ...base, id: "remotion.still", operation: "still", label: "Render still", description: "Render a single frame (Poster) to PNG/JPEG.", inputFormats: ["json", "image"], outputFormats: ["png", "jpg"] },
    ];
  }

  async estimateCost(): Promise<CostEstimate> {
    return { usd: 0, known: true, basis: "local Remotion render" };
  }

  async execute(operation: string, params: Record<string, unknown>, ctx: ExecContext): Promise<ExecResult> {
    const p = z
      .object({
        composition: z.enum(COMPOSITIONS),
        props: z.record(z.string(), z.unknown()).default({}),
        format: z.enum(["png", "jpeg"]).default("png"),
        frame: z.number().int().min(0).default(0),
        crf: z.number().int().min(1).max(51).default(18),
        concurrency: z.number().int().min(1).max(16).optional(),
      })
      .parse(params);
    const renderer = (await import("@remotion/renderer")) as typeof import("@remotion/renderer");
    checkAborted(ctx.signal);
    ctx.progress(0.01, "preparing renderer");
    await renderer.ensureBrowser({ onBrowserDownload: () => {
      ctx.log("info", "downloading Chrome Headless Shell for Remotion (one-time, free)");
      return { version: null, onProgress: () => undefined };
    } });
    const serveUrl = await getBundle(ctx.log);
    checkAborted(ctx.signal);
    const server = new EphemeralFileServer();
    await server.start();
    const { cancelSignal, cancel } = renderer.makeCancelSignal();
    const onAbort = () => cancel();
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const inputProps = bindFiles(p.props, server) as Record<string, unknown>;
      const composition = await renderer.selectComposition({ serveUrl, id: p.composition, inputProps, logLevel: "error" });
      if (operation === "still") {
        const out = path.join(ctx.workDir, `${p.composition.toLowerCase()}.${p.format === "jpeg" ? "jpg" : "png"}`);
        await renderer.renderStill({ serveUrl, composition, output: out, inputProps, frame: p.frame, imageFormat: p.format, ...(p.format === "jpeg" ? { jpegQuality: 92 } : {}), logLevel: "error", cancelSignal });
        return { artifacts: [{ file: out, kind: "image", port: "image", metadata: { width: composition.width, height: composition.height } }] };
      }
      if (operation !== "render") throw new AdapterError("UNSUPPORTED", `remotion has no operation ${operation}`);
      const out = path.join(ctx.workDir, `${p.composition.toLowerCase()}.mp4`);
      await renderer.renderMedia({
        serveUrl,
        composition,
        codec: "h264",
        crf: p.crf,
        pixelFormat: "yuv420p",
        audioCodec: "aac",
        enforceAudioTrack: true,
        outputLocation: out,
        inputProps,
        cancelSignal,
        concurrency: p.concurrency ?? null,
        logLevel: "error",
        onProgress: ({ progress, stitchStage }) => ctx.progress(Math.min(0.99, 0.02 + progress * 0.97), `rendering (${stitchStage})`),
      });
      // Remotion encodes from JPEG frames and tags the stream full-range (yuvj420p). Convert to limited-range
      // yuv420p so every browser/player decodes colours identically (QA requires it).
      ctx.progress(0.995, "normalizing pixel format");
      const final = await toWebSafe(out, ctx);
      // Editable composition: the exact props (with local file paths) to reopen in Remotion Studio or re-render.
      const propsFile = path.join(ctx.workDir, "composition.json");
      fs.writeFileSync(propsFile, JSON.stringify({ composition: p.composition, props: p.props }, null, 2));
      return {
        artifacts: [
          { file: propsFile, kind: "json", port: "composition", label: `${p.composition} composition props (editable)` },{ file: final, kind: "video", port: "video", metadata: { composition: p.composition, width: composition.width, height: composition.height, fps: composition.fps, durationInFrames: composition.durationInFrames } }],
      };
    } catch (err) {
      if (ctx.signal.aborted) throw new AdapterError("CANCELLED", "render cancelled");
      if (err instanceof AdapterError) throw err;
      throw new AdapterError("TOOL_FAILED", `Remotion: ${(err as Error).message}`);
    } finally {
      ctx.signal.removeEventListener("abort", onAbort);
      await server.stop();
    }
  }
}
