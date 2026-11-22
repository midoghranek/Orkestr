import { z } from "zod";
import type { Graph, Scene } from "@/shared/schema";
import { GraphSchema } from "@/shared/schema";
import { getDb, json, tx } from "./db";
import { newId } from "./util/ids";

export const ProjectSettingsSchema = z.object({
  /** Public URL of the product to capture real UI from. */
  productUrl: z.string().url().optional(),
  brandName: z.string().max(80).optional(),
  /** How the brand is pronounced in narration (may differ from how it is written). */
  brandPronunciation: z.string().max(80).optional(),
  language: z.string().max(40).optional(),
  palette: z.record(z.string(), z.string()).optional(),
  /** Facts the AI may use. Anything not listed here must not be claimed. */
  verifiedClaims: z.array(z.string().max(400)).max(60).default([]),
  brandNotes: z.string().max(4000).optional(),
  voiceId: z.string().max(60).optional(),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string;
  brief: string;
  status: string;
  budgetUsd: number;
  settings: ProjectSettings;
  createdAt: number;
  updatedAt: number;
}

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  brief: string;
  status: string;
  budget_usd: number;
  settings_json: string;
  created_at: number;
  updated_at: number;
}

const fromRow = (r: ProjectRow): Project => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  description: r.description,
  brief: r.brief,
  status: r.status,
  budgetUsd: r.budget_usd,
  settings: ProjectSettingsSchema.parse(json(r.settings_json, {})),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const NewProjectSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9-]{1,60}$/).optional(),
  description: z.string().max(2000).default(""),
  brief: z.string().max(8000).default(""),
  budgetUsd: z.number().min(0).max(100000).default(0),
  settings: ProjectSettingsSchema.default({ verifiedClaims: [] }),
});

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";
}

export function createProject(input: z.input<typeof NewProjectSchema>): Project {
  const p = NewProjectSchema.parse(input);
  const db = getDb();
  let slug = p.slug ?? slugify(p.name);
  for (let i = 2; db.prepare("SELECT 1 FROM projects WHERE slug = ?").get(slug); i++) slug = `${p.slug ?? slugify(p.name)}-${i}`;
  const id = newId("prj");
  const t = Date.now();
  db.prepare("INSERT INTO projects (id, slug, name, description, brief, budget_usd, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    id,
    slug,
    p.name,
    p.description,
    p.brief,
    p.budgetUsd,
    JSON.stringify(p.settings),
    t,
    t,
  );
  return getProject(id)!;
}

export function getProject(idOrSlug: string): Project | undefined {
  const r = getDb().prepare("SELECT * FROM projects WHERE id = ? OR slug = ?").get(idOrSlug, idOrSlug) as ProjectRow | undefined;
  return r ? fromRow(r) : undefined;
}

export function listProjects(): (Project & { stats: { workflows: number; runs: number; assets: number; lastRunStatus: string | null } })[] {
  const rows = getDb().prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as unknown as ProjectRow[];
  return rows.map((r) => {
    const s = getDb()
      .prepare(
        `SELECT (SELECT COUNT(*) FROM workflows WHERE project_id = @id) w, (SELECT COUNT(*) FROM runs WHERE project_id = @id) r, (SELECT COUNT(*) FROM assets WHERE project_id = @id) a,
                (SELECT status FROM runs WHERE project_id = @id ORDER BY created_at DESC LIMIT 1) ls`,
      )
      .get({ id: r.id }) as { w: number; r: number; a: number; ls: string | null };
    return { ...fromRow(r), stats: { workflows: s.w, runs: s.r, assets: s.a, lastRunStatus: s.ls } };
  });
}

export const ProjectPatchSchema = NewProjectSchema.partial().extend({ status: z.enum(["draft", "active", "archived"]).optional() });

export function updateProject(id: string, patch: z.input<typeof ProjectPatchSchema>): Project {
  const p = ProjectPatchSchema.parse(patch);
  const cur = getProject(id);
  if (!cur) throw new Error("project not found");
  const next = { ...cur, ...p, settings: p.settings ? ProjectSettingsSchema.parse({ ...cur.settings, ...p.settings }) : cur.settings };
  getDb()
    .prepare("UPDATE projects SET name=?, description=?, brief=?, budget_usd=?, status=?, settings_json=?, updated_at=? WHERE id=?")
    .run(next.name, next.description, next.brief, next.budgetUsd, next.status, JSON.stringify(next.settings), Date.now(), cur.id);
  return getProject(cur.id)!;
}

export function deleteProject(id: string): void {
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
}

/* ------------------------------ Workflows ------------------------------ */

export interface Workflow {
  id: string;
  projectId: string;
  name: string;
  graph: Graph;
  version: number;
  source: string;
  createdAt: number;
  updatedAt: number;
}

interface WorkflowRow {
  id: string;
  project_id: string;
  name: string;
  graph_json: string;
  version: number;
  source: string;
  created_at: number;
  updated_at: number;
}

const wfFromRow = (r: WorkflowRow): Workflow => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  graph: json<Graph>(r.graph_json, { version: 1, nodes: [], edges: [] }),
  version: r.version,
  source: r.source,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function createWorkflow(projectId: string, name: string, graph: unknown, source = "user"): Workflow {
  const g = GraphSchema.parse(graph);
  const id = newId("wf");
  const t = Date.now();
  getDb().prepare("INSERT INTO workflows (id, project_id, name, graph_json, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, projectId, name.slice(0, 120), JSON.stringify(g), source, t, t);
  return getWorkflow(id)!;
}

export function getWorkflow(id: string): Workflow | undefined {
  const r = getDb().prepare("SELECT * FROM workflows WHERE id = ?").get(id) as WorkflowRow | undefined;
  return r ? wfFromRow(r) : undefined;
}

export function listWorkflows(projectId: string): Workflow[] {
  return (getDb().prepare("SELECT * FROM workflows WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as unknown as WorkflowRow[]).map(wfFromRow);
}

/** Save with optimistic concurrency: `expectedVersion` must match, so two tabs can't silently overwrite each other. */
export function saveWorkflow(id: string, patch: { name?: string; graph?: unknown; expectedVersion?: number }): Workflow {
  const cur = getWorkflow(id);
  if (!cur) throw new Error("workflow not found");
  if (patch.expectedVersion !== undefined && patch.expectedVersion !== cur.version) throw new Error(`version conflict: workflow is at v${cur.version}`);
  const graph = patch.graph === undefined ? cur.graph : GraphSchema.parse(patch.graph);
  getDb().prepare("UPDATE workflows SET name=?, graph_json=?, version=version+1, updated_at=? WHERE id=?").run((patch.name ?? cur.name).slice(0, 120), JSON.stringify(graph), Date.now(), id);
  return getWorkflow(id)!;
}

export function deleteWorkflow(id: string): void {
  getDb().prepare("DELETE FROM workflows WHERE id = ?").run(id);
}

/* ------------------------------ Scenes (storyboard) ------------------------------ */

export interface SceneRow {
  id: string;
  project_id: string;
  storyboard: string;
  idx: number;
  title: string;
  duration_s: number;
  aspect: string;
  prompt: string;
  narration: string;
  on_screen_text: string;
  camera: string;
  constraints_json: string;
  references_json: string;
  tool: string;
  settings_json: string;
  status: string;
  selected_asset_id: string | null;
  cost_usd: number;
  notes: string;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface StoredScene {
  id: string;
  projectId: string;
  storyboard: string;
  idx: number;
  title: string;
  durationS: number;
  aspect: string;
  prompt: string;
  narration: string;
  onScreenText: string;
  camera: string;
  constraints: string[];
  references: string[];
  tool: string;
  settings: Record<string, unknown>;
  status: "draft" | "generating" | "review" | "approved" | "rejected" | "failed";
  selectedAssetId: string | null;
  costUsd: number;
  notes: string;
  version: number;
}

const sceneFromRow = (r: SceneRow): StoredScene => ({
  id: r.id,
  projectId: r.project_id,
  storyboard: r.storyboard,
  idx: r.idx,
  title: r.title,
  durationS: r.duration_s,
  aspect: r.aspect,
  prompt: r.prompt,
  narration: r.narration,
  onScreenText: r.on_screen_text,
  camera: r.camera,
  constraints: json(r.constraints_json, []),
  references: json(r.references_json, []),
  tool: r.tool,
  settings: json(r.settings_json, {}),
  status: r.status as StoredScene["status"],
  selectedAssetId: r.selected_asset_id,
  costUsd: r.cost_usd,
  notes: r.notes,
  version: r.version,
});

export function listScenes(projectId: string, storyboard?: string): StoredScene[] {
  const rows = storyboard
    ? getDb().prepare("SELECT * FROM scenes WHERE project_id = ? AND storyboard = ? ORDER BY idx").all(projectId, storyboard)
    : getDb().prepare("SELECT * FROM scenes WHERE project_id = ? ORDER BY storyboard, idx").all(projectId);
  return (rows as unknown as SceneRow[]).map(sceneFromRow);
}

export function getScene(id: string): StoredScene | undefined {
  const r = getDb().prepare("SELECT * FROM scenes WHERE id = ?").get(id) as SceneRow | undefined;
  return r ? sceneFromRow(r) : undefined;
}

export function replaceStoryboard(projectId: string, storyboard: string, scenes: (Scene & { aspect?: string; settings?: Record<string, unknown> })[]): StoredScene[] {
  const db = getDb();
  const t = Date.now();
  tx(db, () => {
    db.prepare("DELETE FROM scenes WHERE project_id = ? AND storyboard = ?").run(projectId, storyboard);
    const st = db.prepare(
      `INSERT INTO scenes (id, project_id, storyboard, idx, title, duration_s, aspect, prompt, narration, on_screen_text, camera, constraints_json, references_json, tool, settings_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    );
    scenes.forEach((s, i) =>
      st.run(newId("scn"), projectId, storyboard, i, s.title, s.durationS, s.aspect ?? "16:9", s.prompt, s.narration, s.onScreenText, s.camera, JSON.stringify(s.constraints), JSON.stringify(s.references), s.tool || s.visualSource, JSON.stringify({ visualSource: s.visualSource, ...s.settings }), t, t),
    );
  });
  return listScenes(projectId, storyboard);
}

export const ScenePatchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  durationS: z.number().min(0.5).max(120).optional(),
  prompt: z.string().max(4000).optional(),
  narration: z.string().max(2000).optional(),
  onScreenText: z.string().max(500).optional(),
  camera: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  status: z.enum(["draft", "review", "approved", "rejected"]).optional(),
  selectedAssetId: z.string().max(64).nullable().optional(),
});

export function updateScene(id: string, patch: z.input<typeof ScenePatchSchema>): StoredScene {
  const p = ScenePatchSchema.parse(patch);
  const cur = getScene(id);
  if (!cur) throw new Error("scene not found");
  if (p.selectedAssetId) {
    const a = getDb().prepare("SELECT project_id FROM assets WHERE id = ?").get(p.selectedAssetId) as { project_id: string } | undefined;
    if (!a || a.project_id !== cur.projectId) throw new Error("asset does not belong to this project");
  }
  const n = { ...cur, ...p };
  const contentChanged = p.prompt !== undefined || p.narration !== undefined || p.onScreenText !== undefined || p.durationS !== undefined || p.camera !== undefined;
  getDb()
    .prepare("UPDATE scenes SET title=?, duration_s=?, prompt=?, narration=?, on_screen_text=?, camera=?, notes=?, status=?, selected_asset_id=?, version=version+?, updated_at=? WHERE id=?")
    .run(n.title, n.durationS, n.prompt, n.narration, n.onScreenText, n.camera, n.notes, contentChanged && cur.status === "approved" && !p.status ? "draft" : n.status, n.selectedAssetId, contentChanged ? 1 : 0, Date.now(), id);
  return getScene(id)!;
}
