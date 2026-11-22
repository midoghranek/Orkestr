import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { z } from "zod";
import { ROOT_DIR, dataDir } from "../util/paths";
import { sha256 } from "../util/ids";
import { EphemeralFileServer } from "../util/fileserver";
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
function sourceHash(): string {
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

/** Replace `{"$file": "<abs path>"}` leaves with loopback URLs served for the duration of the render. */
export function bindFiles(value: unknown, server: EphemeralFileServer): unknown {
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
        await renderer.renderStill({ serveUrl, composition, output: out, inputProps, frame: p.frame, imageFormat: p.format, jpegQuality: 92, logLevel: "error", cancelSignal });
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
      return {
        artifacts: [{ file: out, kind: "video", port: "video", metadata: { composition: p.composition, width: composition.width, height: composition.height, fps: composition.fps, durationInFrames: composition.durationInFrames } }],
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
