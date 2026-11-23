/**
 * Integration tests with REAL local tools (free): FFmpeg, Playwright, Remotion, whisper.cpp, FilmCraft.
 * Each suite skips (with a reason) when its tool is not installed, so CI without the tools stays green
 * while this machine exercises the real integrations.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshEnv } from "../helpers";
import { closeDb, getDb } from "@/server/db";
import { runDiscovery, readyCapabilities } from "@/server/adapters/registry";
import { createProject, createWorkflow } from "@/server/projects";
import { Engine, createRun } from "@/server/engine/engine";
import { FfmpegAdapter } from "@/server/adapters/ffmpeg";
import { technicalQa } from "@/server/qa";
import { listExports } from "@/server/exports";
import type { Graph } from "@/shared/schema";

const realWhisperDir = path.join(process.cwd(), "data", "tools", "whisper.cpp");
let ready = new Set<string>();
let server: http.Server;
let url = "";

beforeAll(async () => {
  freshEnv("integration");
  process.env.ORKESTR_WHISPER_DIR = realWhisperDir; // reuse the installed binary + models
  closeDb();
  getDb();
  await runDiscovery();
  ready = readyCapabilities();
  // A local page to capture (Playwright only accepts http(s)).
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html dir="rtl"><body style="margin:0;font:48px sans-serif;background:#17140F;color:#F4EFE4;display:grid;place-items:center;height:100vh">صباحك على مزاجك</body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const a = server.address();
  url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}/`;
}, 180_000);

afterAll(async () => {
  server?.close();
  closeDb();
});

const has = (...caps: string[]) => caps.every((c) => ready.has(c));

describe("ffmpeg + QA", () => {
  it("encodes, loops and validates a clip with ffprobe", async (ctx) => {
    if (!has("ffmpeg.encode", "ffmpeg.loop")) return ctx.skip();
    const ff = new FfmpegAdapter();
    await ff.discover();
    const dir = fs.mkdtempSync(path.join(process.env.ORKESTR_DATA_DIR!, "ff-"));
    const src = path.join(dir, "src.mp4");
    const { runAllowed } = await import("@/server/util/proc");
    const r = await runAllowed("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src]);
    expect(r.code).toBe(0);
    const ctxExec = { signal: new AbortController().signal, workDir: dir, projectId: "t", runId: "t", nodeRunId: "t", progress: () => undefined, log: () => undefined };
    const looped = await ff.execute("loop", { input: src, crossfadeS: 0.5, webm: false }, ctxExec);
    const qa = await technicalQa(looped.artifacts[0].file, { expectWidth: 640, expectHeight: 360, expectFps: 30, minDurationS: 3.4, maxDurationS: 3.6, requireAudio: false });
    expect(qa.pass).toBe(true);
    expect(qa.facts.durationS).toBeCloseTo(3.5, 1);
    const bad = await technicalQa(src, { expectWidth: 1920, expectHeight: 1080 });
    expect(bad.pass).toBe(false);
    expect(bad.checks.find((c) => c.name === "resolution")?.pass).toBe(false);
  });

  it("reports corrupt media instead of crashing", async (ctx) => {
    if (!has("ffmpeg.probe")) return ctx.skip();
    const f = path.join(process.env.ORKESTR_DATA_DIR!, "corrupt.mp4");
    fs.writeFileSync(f, "this is not a video");
    const qa = await technicalQa(f, {});
    expect(qa.pass).toBe(false);
    expect(qa.checks[0].name).toBe("readable");
  });
});

describe("real end-to-end workflow", () => {
  it("captures real UI, animates it, renders a poster, QA-checks and exports — then reuses everything from cache", async (ctx) => {
    if (!has("playwright.screenshot", "ffmpeg.still", "ffmpeg.encode", "ffmpeg.probe", "ffmpeg.frames", "remotion.still")) return ctx.skip();
    const p = createProject({ name: "Integration" });
    const graph: Graph = {
      version: 1,
      nodes: [
        { id: "cap", type: "image.capture", params: { url, width: 800, height: 450, deviceScaleFactor: 1, waitMs: 0 }, position: { x: 0, y: 0 } },
        { id: "still", type: "video.still", params: { durationS: 2, aspect: "16:9", fps: 30 }, position: { x: 0, y: 0 } },
        { id: "enc", type: "video.encode", params: { aspect: "16:9", fps: 30, crf: 28, audio: false }, position: { x: 0, y: 0 } },
        { id: "qa", type: "production.qa", params: { expectWidth: 1920, expectHeight: 1080, expectFps: 30, minDurationS: 1.9, maxDurationS: 2.1, requireAudio: false, frames: 2 }, position: { x: 0, y: 0 } },
        { id: "poster", type: "image.poster", params: { aspect: "4:5", headline: "صباحك على مزاجك", sub: "integration test" }, position: { x: 0, y: 0 } },
        { id: "export", type: "production.export", params: { name: "it-clip" }, position: { x: 0, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "cap", sourceHandle: "image", target: "still", targetHandle: "image" },
        { id: "e2", source: "still", sourceHandle: "video", target: "enc", targetHandle: "video" },
        { id: "e3", source: "enc", sourceHandle: "video", target: "qa", targetHandle: "video" },
        { id: "e4", source: "cap", sourceHandle: "image", target: "poster", targetHandle: "background" },
        { id: "e5", source: "enc", sourceHandle: "video", target: "export", targetHandle: "asset" },
      ],
    };
    const wf = createWorkflow(p.id, "it", graph);
    const engine = new Engine({ concurrency: 2, pollMs: 50 });
    const run = createRun(wf.id);
    expect(await engine.runToCompletion(run, 600_000)).toBe("completed");

    const nodes = getDb().prepare("SELECT node_id, outputs_json FROM node_runs WHERE run_id = ?").all(run) as { node_id: string; outputs_json: string }[];
    const out = Object.fromEntries(nodes.map((n) => [n.node_id, JSON.parse(n.outputs_json)]));
    const qaAsset = getDb().prepare("SELECT path FROM assets WHERE id = ?").get(out.qa.report[0].assetId) as { path: string };
    const report = JSON.parse(fs.readFileSync(qaAsset.path, "utf8"));
    expect(report.pass).toBe(true);
    expect(report.facts).toMatchObject({ width: 1920, height: 1080, videoCodec: "h264", pixFmt: "yuv420p" });
    const poster = getDb().prepare("SELECT width, height, parents_json FROM assets WHERE id = ?").get(out.poster.image[0].assetId) as { width: number; height: number; parents_json: string };
    expect([poster.width, poster.height]).toEqual([1080, 1350]);
    expect(JSON.parse(poster.parents_json)).toContain(out.cap.image[0].assetId); // lineage
    expect(listExports(p.id).map((e) => e.name)).toContain("it-clip.mp4");

    const run2 = createRun(wf.id);
    expect(await engine.runToCompletion(run2, 120_000)).toBe("completed");
    const cached = getDb().prepare("SELECT COUNT(*) c FROM node_runs WHERE run_id = ? AND cached_from IS NOT NULL").get(run2) as { c: number };
    expect(cached.c).toBe(6); // every node, including the export, is reused: nothing re-renders or re-exports
    await engine.stop();
  }, 900_000);
});

describe("speech", () => {
  it("synthesizes English scratch narration locally and transcribes it back with whisper.cpp", async (ctx) => {
    if (!has("filmcraft.tts", "whisper.transcribe")) return ctx.skip();
    const p = createProject({ name: "Speech" });
    const wf = createWorkflow(p.id, "speech", {
      version: 1,
      nodes: [
        { id: "tts", type: "audio.tts_local", params: { text: "Your cafe, under your control.", voice: "basic-male" }, position: { x: 0, y: 0 } },
        { id: "stt", type: "audio.transcribe", params: { language: "en" }, position: { x: 0, y: 0 } },
      ],
      edges: [{ id: "e", source: "tts", sourceHandle: "audio", target: "stt", targetHandle: "audio" }],
    });
    const engine = new Engine({ concurrency: 1, pollMs: 50 });
    const run = createRun(wf.id);
    expect(await engine.runToCompletion(run, 600_000)).toBe("completed");
    const row = getDb().prepare("SELECT outputs_json FROM node_runs WHERE run_id = ? AND node_id = 'stt'").get(run) as { outputs_json: string };
    const srtId = JSON.parse(row.outputs_json).subtitles[0].assetId;
    const srt = fs.readFileSync((getDb().prepare("SELECT path FROM assets WHERE id = ?").get(srtId) as { path: string }).path, "utf8");
    expect(srt).toMatch(/-->/);
    // Contract, not accuracy: whisper `base` mis-hears FilmCraft's robotic built-in voice (verified: "yom…"),
    // which is exactly why caption review gates exist. Assert timed cues inside the narration length.
    const cues = (await import("@/server/adapters/whisper")).parseSrt(srt);
    expect(cues.length).toBeGreaterThan(0);
    expect(cues.every((c) => c.endMs > c.startMs && c.endMs < 10_000)).toBe(true);
    await engine.stop();
  }, 900_000);

  it("refuses Arabic text in the English-only FilmCraft TTS instead of producing garbage", async (ctx) => {
    if (!has("filmcraft.tts")) return ctx.skip();
    const { FilmCraftAdapter } = await import("@/server/adapters/craft");
    const a = new FilmCraftAdapter();
    await a.discover();
    await expect(a.execute("tts", { text: "صباحك على مزاجك" }, { signal: new AbortController().signal, workDir: process.env.ORKESTR_DATA_DIR!, projectId: "t", runId: "t", nodeRunId: "t", progress: () => undefined, log: () => undefined })).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });
});
