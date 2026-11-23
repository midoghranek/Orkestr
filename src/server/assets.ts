import fs from "node:fs";
import path from "node:path";
import { getDb, json } from "./db";
import { newId, sha256File } from "./util/ids";
import { assetsDir, isUnderAny, resolveInside } from "./util/paths";
import { mimeFor } from "./util/fileserver";
import { FfmpegAdapter, parseRate } from "./adapters/ffmpeg";
import { allowedExecutable } from "./util/proc";

export type AssetKind = "image" | "video" | "audio" | "subtitle" | "json" | "text" | "document";

export interface Asset {
  id: string;
  projectId: string;
  kind: AssetKind;
  label: string;
  path: string;
  mime: string;
  size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  durationS: number | null;
  fps: number | null;
  metadata: Record<string, unknown>;
  parents: string[];
  provenance: Record<string, unknown>;
  nodeRunId: string | null;
  sceneId: string | null;
  version: number;
  createdAt: number;
}

interface AssetRow {
  id: string;
  project_id: string;
  kind: AssetKind;
  label: string;
  path: string;
  mime: string;
  size: number;
  sha256: string;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  fps: number | null;
  metadata_json: string;
  parents_json: string;
  provenance_json: string;
  node_run_id: string | null;
  scene_id: string | null;
  version: number;
  created_at: number;
}

function fromRow(r: AssetRow): Asset {
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    label: r.label,
    path: r.path,
    mime: r.mime,
    size: r.size,
    sha256: r.sha256,
    width: r.width,
    height: r.height,
    durationS: r.duration_s,
    fps: r.fps,
    metadata: json(r.metadata_json, {}),
    parents: json(r.parents_json, []),
    provenance: json(r.provenance_json, {}),
    nodeRunId: r.node_run_id,
    sceneId: r.scene_id,
    version: r.version,
    createdAt: r.created_at,
  };
}

const ffmpeg = new FfmpegAdapter();

/** Media facts from ffprobe (images included: ffprobe reads PNG/JPG/WebP dimensions). */
export async function mediaFacts(file: string, kind: AssetKind): Promise<{ width?: number; height?: number; durationS?: number; fps?: number; streams?: unknown }> {
  if (!["image", "video", "audio"].includes(kind)) return {};
  if (!allowedExecutable("ffprobe")) await ffmpeg.discover().catch(() => undefined);
  if (!allowedExecutable("ffprobe")) return {};
  try {
    const p = await ffmpeg.probe(file);
    const v = p.streams.find((s) => s.codec_type === "video");
    const dur = Number(p.format.duration);
    return {
      width: v?.width,
      height: v?.height,
      durationS: kind === "image" || !Number.isFinite(dur) ? undefined : dur,
      fps: kind === "video" ? parseRate(v?.avg_frame_rate ?? v?.r_frame_rate) : undefined,
      streams: p.streams.map((s) => ({ type: s.codec_type, codec: s.codec_name, width: s.width, height: s.height, channels: s.channels, sampleRate: s.sample_rate })),
    };
  } catch {
    return {};
  }
}

export function kindFromExt(file: string): AssetKind {
  const ext = path.extname(file).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].includes(ext)) return "image";
  if ([".mp4", ".webm", ".mov", ".mkv"].includes(ext)) return "video";
  if ([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg"].includes(ext)) return "audio";
  if ([".srt", ".vtt"].includes(ext)) return "subtitle";
  if (ext === ".json") return "json";
  if ([".txt", ".md"].includes(ext)) return "text";
  return "document";
}

export interface RegisterOptions {
  projectId: string;
  kind?: AssetKind;
  label?: string;
  metadata?: Record<string, unknown>;
  parents?: string[];
  provenance?: Record<string, unknown>;
  nodeRunId?: string | null;
  sceneId?: string | null;
  /** Move instead of copy (for files in a node work dir). */
  move?: boolean;
}

/**
 * Content-addressed storage: data/assets/<project>/<sha[0:2]>/<sha><ext>.
 * Identical bytes are stored once; every registration still gets its own row (own provenance).
 */
export async function registerFile(file: string, opts: RegisterOptions): Promise<Asset> {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`not a file: ${file}`);
  const kind = opts.kind ?? kindFromExt(file);
  const sha = await sha256File(file);
  const ext = path.extname(file).toLowerCase().slice(0, 10);
  const projectDir = resolveInside(assetsDir(), opts.projectId);
  const dest = resolveInside(projectDir, path.join(sha.slice(0, 2), `${sha}${ext}`));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) {
    if (opts.move) {
      try {
        fs.renameSync(file, dest);
      } catch {
        fs.copyFileSync(file, dest);
      }
    } else fs.copyFileSync(file, dest);
  } else if (opts.move) fs.rmSync(file, { force: true });
  const facts = await mediaFacts(dest, kind);
  const prevVersion = opts.sceneId
    ? (getDb().prepare("SELECT COALESCE(MAX(version), 0) v FROM assets WHERE scene_id = ? AND kind = ?").get(opts.sceneId, kind) as { v: number }).v
    : 0;
  const id = newId("ast");
  getDb()
    .prepare(
      `INSERT INTO assets (id, project_id, kind, label, path, mime, size, sha256, width, height, duration_s, fps, metadata_json, parents_json, provenance_json, node_run_id, scene_id, version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      opts.projectId,
      kind,
      (opts.label ?? path.basename(file)).slice(0, 200),
      dest,
      mimeFor(dest),
      stat.size,
      sha,
      facts.width ?? null,
      facts.height ?? null,
      facts.durationS ?? null,
      facts.fps ?? null,
      JSON.stringify({ ...opts.metadata, ...(facts.streams ? { streams: facts.streams } : {}) }),
      JSON.stringify(opts.parents ?? []),
      JSON.stringify(opts.provenance ?? {}),
      opts.nodeRunId ?? null,
      opts.sceneId ?? null,
      prevVersion + 1,
      Date.now(),
    );
  return getAsset(id)!;
}

/** Import a user file. Only files under configured import roots (or the project's own brand folder) are allowed. */
export async function importFile(file: string, roots: string[], opts: RegisterOptions): Promise<Asset> {
  const abs = path.resolve(file);
  if (!isUnderAny(abs, roots)) throw new Error(`import blocked: ${abs} is outside the allowed import folders`);
  return registerFile(abs, { ...opts, provenance: { source: "import", originalPath: abs, ...opts.provenance } });
}

export function getAsset(id: string): Asset | undefined {
  const r = getDb().prepare("SELECT * FROM assets WHERE id = ?").get(id) as AssetRow | undefined;
  return r ? fromRow(r) : undefined;
}

export function listAssets(projectId: string, filter: { kind?: string; sceneId?: string; limit?: number } = {}): Asset[] {
  const where = ["project_id = ?"];
  const args: (string | number)[] = [projectId];
  if (filter.kind) {
    where.push("kind = ?");
    args.push(filter.kind);
  }
  if (filter.sceneId) {
    where.push("scene_id = ?");
    args.push(filter.sceneId);
  }
  args.push(filter.limit ?? 500);
  return (getDb().prepare(`SELECT * FROM assets WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`).all(...args) as unknown as AssetRow[]).map(fromRow);
}

export function assetExists(a: Asset): boolean {
  try {
    return fs.statSync(a.path).size === a.size;
  } catch {
    return false;
  }
}

/** Ancestors (provenance chain) of an asset, nearest first. */
export function lineage(id: string, depth = 12): Asset[] {
  const out: Asset[] = [];
  const seen = new Set<string>();
  let frontier = [id];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const fid of frontier) {
      const a = getAsset(fid);
      if (!a) continue;
      for (const p of a.parents) {
        if (seen.has(p)) continue;
        seen.add(p);
        const pa = getAsset(p);
        if (pa) {
          out.push(pa);
          next.push(p);
        }
      }
    }
    frontier = next;
  }
  return out;
}
