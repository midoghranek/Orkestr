import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getDb, json } from "../db";
import { dataDir } from "../util/paths";
import { runFile, which } from "../util/proc";
import { FfmpegAdapter } from "./ffmpeg";
import { AniCraftAdapter, EffectCraftAdapter, FilmCraftAdapter, PhotoCraftAdapter, SoundCraftAdapter, VectorCraftAdapter } from "./craft";
import { WhisperAdapter } from "./whisper";
import { RemotionAdapter } from "./remotion";
import { ElevenLabsAdapter } from "./elevenlabs";
import { PlaywrightAdapter } from "./playwright";
import { ClaudeAdapter } from "./claude";
import { MockAdapter } from "./mock";
import type { CapabilitySpec, Discovery, Health, ToolAdapter } from "./types";

let adapters: Map<string, ToolAdapter> | undefined;

export function getAdapters(): Map<string, ToolAdapter> {
  if (adapters) return adapters;
  const list: ToolAdapter[] = [
    new FfmpegAdapter(),
    new RemotionAdapter(),
    new WhisperAdapter(),
    new PlaywrightAdapter(),
    new ElevenLabsAdapter(),
    new ClaudeAdapter(),
    new PhotoCraftAdapter(),
    new FilmCraftAdapter(),
    new SoundCraftAdapter(),
    new EffectCraftAdapter(),
    new AniCraftAdapter(),
    new VectorCraftAdapter(),
  ];
  if (process.env.ORKESTR_ENABLE_MOCK === "1") list.push(new MockAdapter());
  adapters = new Map(list.map((a) => [a.id, a]));
  return adapters;
}

export function getAdapter(id: string): ToolAdapter | undefined {
  return getAdapters().get(id);
}

export interface OptionalTool {
  id: string;
  name: string;
  status: "missing" | "present-no-adapter" | "not-needed";
  reason: string;
  enables: string;
}

/**
 * Optional tools from the build brief that have no Orkestr adapter. Each is actually checked
 * (PATH lookup, local port probe, credential lookup) so the report never claims more than it saw.
 */
export async function checkOptionalTools(): Promise<OptionalTool[]> {
  const onPath = (cmd: string) => which(cmd);
  const port = async (url: string) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      return r.ok;
    } catch {
      return false;
    }
  };
  const { getCredential } = await import("../credentials");
  const cred = async (p: "fal" | "runway" | "higgsfield") => !!(await getCredential(p).catch(() => undefined));
  const resolveDir = ["C:\\Program Files\\Blackmagic Design\\DaVinci Resolve", "/opt/resolve"].find((d) => fs.existsSync(d));
  const python = onPath("python3") ?? (onPath("python") && !/WindowsApps/i.test(onPath("python") ?? "") ? onPath("python") : undefined);
  const entry = (id: string, name: string, found: string | boolean | undefined, missingReason: string, enables: string): OptionalTool => ({
    id,
    name,
    status: found ? "present-no-adapter" : "missing",
    reason: found ? `found (${typeof found === "string" ? found : "responding"}) but Orkestr has no adapter for it yet` : missingReason,
    enables,
  });
  const comfy = await port("http://127.0.0.1:8188/system_stats");
  return [
    entry("comfyui", "ComfyUI", comfy, "no server answered on 127.0.0.1:8188", "local image/video generation"),
    entry("blender", "Blender", onPath("blender"), "blender not on PATH", "3D product shots"),
    entry("whisperx", "WhisperX", onPath("whisperx"), python ? "whisperx not installed" : "needs Python, which is not installed", "diarization, forced alignment"),
    entry("realesrgan", "Real-ESRGAN", onPath("realesrgan-ncnn-vulkan"), "realesrgan-ncnn-vulkan not on PATH", "image/video upscaling"),
    entry("mediainfo", "MediaInfo", onPath("mediainfo"), "mediainfo not on PATH (ffprobe covers validation)", "extra container metadata"),
    entry("davinci", "DaVinci Resolve", resolveDir, "not found in the default install folder", "color grading/finishing"),
    entry("runway", "Runway", await cred("runway"), "no API key configured", "text/image-to-video generation"),
    entry("fal", "fal.ai", await cred("fal"), "no API key configured", "image/video generation models"),
    entry("higgsfield", "Higgsfield", await cred("higgsfield"), "no API key configured (an MCP connector in a Claude chat session is not reachable by the local app)", "video generation"),
    { id: "sharp", name: "Sharp", status: "not-needed", reason: "not installed on purpose: PhotoCraft + ffmpeg cover the verified image operations", enables: "fast image resizing" },
  ];
}

export interface RegistryEntry {
  id: string;
  name: string;
  kind: ToolAdapter["kind"];
  homepage?: string;
  discovery: Discovery;
  health: Health;
  capabilities: (CapabilitySpec & { ready: boolean; blockedReason?: string })[];
  checkedAt: number;
}

export interface Registry {
  generatedAt: number;
  environment: Record<string, unknown>;
  tools: RegistryEntry[];
  unavailable: OptionalTool[];
}

async function environment(): Promise<Record<string, unknown>> {
  const env: Record<string, unknown> = {
    os: `${os.type()} ${os.release()} (${process.platform}/${process.arch})`,
    node: process.version,
    cpus: os.cpus().length,
    memoryGb: Math.round(os.totalmem() / 1e9),
    wsl: !!which("wsl"),
    python: !!which("python3") || !!(which("python") && !/WindowsApps/i.test(which("python") ?? "")),
  };
  const smi = which("nvidia-smi");
  if (smi) {
    const r = await runFile(smi, ["--query-gpu=name,memory.total", "--format=csv,noheader"], { timeoutMs: 15_000 }).catch(() => undefined);
    env.gpu = r?.stdout.trim() || "unknown";
  }
  try {
    const st = fs.statfsSync(dataDir());
    env.freeDiskGb = Math.round((st.bavail * st.bsize) / 1e9);
  } catch {
    /* not supported */
  }
  return env;
}

/** Full discovery + health pass. Never spends credits: health checks only use read-only/local calls. */
export async function runDiscovery(): Promise<Registry> {
  const tools: RegistryEntry[] = [];
  await Promise.all(
    [...getAdapters().values()].map(async (a) => {
      const t = Date.now();
      let discovery: Discovery;
      let health: Health;
      try {
        discovery = await a.discover();
      } catch (e) {
        discovery = { found: false, reason: (e as Error).message };
      }
      try {
        health = await a.healthCheck();
      } catch (e) {
        health = { status: "unavailable", message: (e as Error).message, checkedAt: t, readyCapabilities: [], blocked: {} };
      }
      const caps = a.capabilities().map((c) => ({
        ...c,
        ready: health.readyCapabilities.includes(c.id) && !health.blocked[c.id],
        blockedReason: health.blocked[c.id] ?? (health.readyCapabilities.includes(c.id) ? undefined : health.message),
      }));
      tools.push({ id: a.id, name: a.name, kind: a.kind, homepage: a.homepage, discovery, health, capabilities: caps, checkedAt: Date.now() });
    }),
  );
  tools.sort((x, y) => x.id.localeCompare(y.id));
  const registry: Registry = { generatedAt: Date.now(), environment: await environment(), tools, unavailable: await checkOptionalTools() };
  const db = getDb();
  const st = db.prepare("INSERT INTO tool_registry (tool_id, json, checked_at) VALUES (?, ?, ?) ON CONFLICT(tool_id) DO UPDATE SET json=excluded.json, checked_at=excluded.checked_at");
  for (const t of tools) st.run(t.id, JSON.stringify(t), t.checkedAt);
  st.run("__environment", JSON.stringify(registry.environment), registry.generatedAt);
  st.run("__optional", JSON.stringify(registry.unavailable), registry.generatedAt);
  fs.writeFileSync(path.join(dataDir(), "capabilities.json"), JSON.stringify(registry, null, 2));
  return registry;
}

/** Last persisted registry (cheap; no process spawning). */
export function loadRegistry(): Registry | undefined {
  const rows = getDb().prepare("SELECT tool_id, json, checked_at FROM tool_registry").all() as { tool_id: string; json: string; checked_at: number }[];
  if (!rows.length) return undefined;
  const envRow = rows.find((r) => r.tool_id === "__environment");
  const optRow = rows.find((r) => r.tool_id === "__optional");
  const tools = rows.filter((r) => !r.tool_id.startsWith("__")).map((r) => json<RegistryEntry>(r.json, null as unknown as RegistryEntry));
  return {
    generatedAt: envRow?.checked_at ?? Math.max(...rows.map((r) => r.checked_at)),
    environment: json(envRow?.json, {}),
    tools: tools.sort((a, b) => a.id.localeCompare(b.id)),
    unavailable: json<OptionalTool[]>(optRow?.json, []),
  };
}

export function readyCapabilities(): Set<string> {
  const reg = loadRegistry();
  const set = new Set<string>();
  for (const t of reg?.tools ?? []) for (const c of t.capabilities) if (c.ready) set.add(c.id);
  if (process.env.ORKESTR_ENABLE_MOCK === "1") for (const c of new MockAdapter().capabilities()) set.add(c.id);
  return set;
}

export function capabilitySpec(id: string): CapabilitySpec | undefined {
  const [adapterId] = id.split(".");
  return getAdapter(adapterId)?.capabilities().find((c) => c.id === id);
}
