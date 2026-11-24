import fs from "node:fs";
import type { DirectorPlan, EditOp, Graph } from "@/shared/schema";
import { DirectorPlanSchema, EditOpsSchema } from "@/shared/schema";
import { getDb, json } from "./db";
import { newId } from "./util/ids";
import { emit } from "./events";
import { createProject, createWorkflow, getProject, getWorkflow, replaceStoryboard, saveWorkflow, updateProject, type Project } from "./projects";
import { assetRole, getAsset, listAssets, type Asset } from "./assets";
import { acceptPlan, getPlan, planToGraph, queuePlan, savePlanVersion, type BuildOptions } from "./director";
import { createRun, retryFailed } from "./engine/engine";
import { validateGraph } from "./engine/validate";
import { readyCapabilities, loadRegistry } from "./adapters/registry";
import { getSettings } from "./settings";
import { RECIPES, getRecipe, pickCta, recipeConstraints, recipePlan, understandIntent, type Intent } from "./recipes";
import { improvePlan, reviewPlan, technicalIssues, type CreativeIssue, type CreativeReport } from "./creative-qa";
import { applyEdits, needsAi, parseInstruction, EditError } from "./edits";
import { ClaudeAdapter, DEFAULT_MODEL } from "./adapters/claude";
import { recordCost } from "./costs";
import { listApprovals, type ApprovalView } from "./views";
import { HttpError } from "./http";

/**
 * The production coordinator: the layer that lets a person say what they want and get a finished piece, while
 * the existing deterministic engine does the work. It never executes tools itself — it builds validated graphs,
 * creates runs and reads their state. Every step is durable (rows in SQLite) and advanced by the worker, so a
 * crash or restart resumes where it was.
 *
 *   researching (website inspection run) → planning (AI Director or free recipe planner) → direction (the user
 *   reviews) → producing (render run, with inline approvals) → done | failed (with a recovery action)
 */

export type ProductionStatus = "researching" | "planning" | "direction" | "producing" | "done" | "failed";

export interface ProductionIntent extends Intent {
  /** "ai" = AI Director (Claude), "recipe" = free deterministic planner. */
  planner: "ai" | "recipe";
  voice: { kind: "none" } | { kind: "asset"; assetId: string } | { kind: "elevenlabs"; voiceId: string };
  /** Asset ids the user attached when creating. */
  assetIds: string[];
}

interface ProductionRow {
  id: string;
  project_id: string;
  status: ProductionStatus;
  recipe: string;
  intent_json: string;
  research_run_id: string | null;
  plan_id: string | null;
  workflow_id: string | null;
  run_id: string | null;
  budget_usd: number;
  error: string | null;
  created_at: number;
  updated_at: number;
}

const db = () => getDb();
const touch = (id: string, patch: Partial<Pick<ProductionRow, "status" | "research_run_id" | "plan_id" | "workflow_id" | "run_id" | "error" | "budget_usd" | "recipe" | "intent_json">>) => {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  db()
    .prepare(`UPDATE productions SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => (patch[k] ?? null) as string | number | null), Date.now(), id);
};

function getRow(id: string): ProductionRow | undefined {
  return db().prepare("SELECT * FROM productions WHERE id = ?").get(id) as ProductionRow | undefined;
}

export function latestProduction(projectId: string): ProductionRow | undefined {
  return db().prepare("SELECT * FROM productions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(projectId) as ProductionRow | undefined;
}

export function claudeReady(): boolean {
  return readyCapabilities().has("claude.plan");
}

/* ------------------------------------ Create ------------------------------------ */

export interface CreateInput {
  prompt: string;
  url?: string;
  recipeId?: string;
  projectId?: string;
  planner?: "ai" | "recipe" | "auto";
  assetIds?: string[];
}

function nameFromPrompt(prompt: string, url?: string, recipeLabel = "New creation"): string {
  if (url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
      return host.charAt(0).toUpperCase() + host.slice(1);
    } catch {
      /* fall through */
    }
  }
  const m = prompt.match(/\bfor (?:my |our |the )?([A-Za-z0-9][\w&' -]{1,40}?)(?:[.,!]| app| product| café| cafe| restaurant| brand|$)/i);
  if (m && !/^(a|an|my|our|the)$/i.test(m[1].trim())) return m[1].trim().replace(/\b\w/g, (c) => c.toUpperCase());
  // No brand named: a clear placeholder the user can rename beats a truncated sentence.
  return recipeLabel;
}

/** Start a creation from a natural-language request. Returns immediately; the worker advances it. */
export function startCreation(input: CreateInput): { productionId: string; project: Project; intent: ProductionIntent } {
  const prompt = input.prompt.trim();
  if (prompt.length < 3) throw new HttpError(400, "Tell Orkestr what you want to create.");
  let project = input.projectId ? getProject(input.projectId) : undefined;
  if (input.projectId && !project) throw new HttpError(404, "project not found");
  const photos = (input.assetIds ?? []).map((id) => getAsset(id)).filter((a): a is Asset => !!a && assetRole(a) === "photo").length;
  const base = understandIntent({ prompt, url: input.url, recipeId: input.recipeId, photoCount: photos + (project ? listAssets(project.id).filter((a) => assetRole(a) === "photo").length : 0) });
  if (base.url) {
    try {
      const u = new URL(base.url);
      if (!/^https?:$/.test(u.protocol)) throw new Error("protocol");
    } catch {
      throw new HttpError(400, `"${base.url}" is not a website address Orkestr can open (use http:// or https://).`);
    }
  }
  if (!project) {
    project = createProject({ name: nameFromPrompt(prompt, base.url, getRecipe(base.recipeId)?.label), brief: prompt, settings: { verifiedClaims: [], language: base.language, ...(base.url ? { productUrl: base.url } : {}) } });
  } else {
    if (project.name === "New creation") project = updateProject(project.id, { name: nameFromPrompt(prompt, base.url, getRecipe(base.recipeId)?.label) });
    project = updateProject(project.id, { brief: prompt, settings: { ...(base.url ? { productUrl: base.url } : {}), language: project.settings.language ?? base.language } as never });
  }
  // Attached assets may belong to a scratch project (uploads before the project existed): move them in.
  for (const id of input.assetIds ?? []) {
    const a = getAsset(id);
    if (a && a.projectId !== project.id) db().prepare("UPDATE assets SET project_id = ? WHERE id = ?").run(project.id, id);
  }
  const plannerChoice = input.planner ?? "auto";
  const planner: "ai" | "recipe" = plannerChoice === "recipe" ? "recipe" : plannerChoice === "ai" ? "ai" : claudeReady() ? "ai" : "recipe";
  if (planner === "ai" && !claudeReady()) throw new HttpError(409, "The AI Director (Claude Code) is not available on this machine. Use the free recipe planner instead.");
  const intent: ProductionIntent = { ...base, planner, voice: { kind: "none" }, assetIds: input.assetIds ?? [] };
  const id = newId("prd");
  const t = Date.now();
  db()
    .prepare("INSERT INTO productions (id, project_id, status, recipe, intent_json, budget_usd, created_at, updated_at) VALUES (?, ?, 'planning', ?, ?, ?, ?, ?)")
    .run(id, project.id, intent.recipeId, JSON.stringify(intent), project.budgetUsd, t, t);
  emit({ type: "production.created", message: `creating: ${prompt.slice(0, 80)}`, projectId: project.id, data: { productionId: id } });
  // Website first (free, local): its brand, copy and screens make every later step better.
  const url = base.url ?? project.settings.productUrl;
  if (url && readyCapabilities().has("playwright.inspect") && !project.settings.website) startResearch(id, project, url);
  else planNow(id);
  return { productionId: id, project: getProject(project.id)!, intent };
}

function startResearch(productionId: string, project: Project, url: string): void {
  const graph: Graph = {
    version: 1,
    nodes: [{ id: "inspect", type: "web.inspect", label: "Read your website", params: { url, locale: /arab/i.test(project.settings.language ?? "") ? "ar-EG" : "en-US" }, position: { x: 0, y: 0 } }],
    edges: [],
    meta: { generatedBy: "producer", purpose: "research" },
  };
  const wf = createWorkflow(project.id, "Website research", graph, "producer");
  const runId = createRun(wf.id);
  touch(productionId, { status: "researching", research_run_id: runId });
}

/** Turn the research output into project settings: brand name, palette, website facts, logo role. */
function applyResearch(row: ProductionRow): void {
  const nr = db().prepare("SELECT outputs_json, status FROM node_runs WHERE run_id = ? AND node_id = 'inspect'").get(row.research_run_id!) as { outputs_json: string; status: string } | undefined;
  const out = json<Record<string, { assetId?: string }[]>>(nr?.outputs_json, {});
  const brandAsset = out.brand?.[0]?.assetId ? getAsset(out.brand[0].assetId) : undefined;
  if (!brandAsset) return;
  const facts = json<{ url: string; title: string; description: string; siteName: string; lang: string; dir: "rtl" | "ltr"; headings: string[]; ctas: string[]; colors: { bg: string; fg: string; accent: string | null; others: string[] }; themeColor: string | null }>(fs.readFileSync(brandAsset.path, "utf8"), null as never);
  if (!facts) return;
  const project = getProject(row.project_id)!;
  const brandName = project.settings.brandName ?? (facts.siteName || facts.title.split(/\s[|–—-]\s|[|–—]/)[0].trim() || project.name).slice(0, 80);
  const palette = paletteFromSite(facts.colors, facts.themeColor);
  updateProject(project.id, {
    name: project.name,
    settings: {
      brandName,
      productUrl: facts.url || project.settings.productUrl,
      ...(project.settings.palette ? {} : { palette }),
      website: { url: facts.url, title: facts.title, description: facts.description, headings: facts.headings, ctas: facts.ctas, dir: facts.dir, lang: facts.lang, inspectedAt: Date.now() },
    } as never,
  });
  if (out.logo?.[0]?.assetId) {
    const logo = getAsset(out.logo[0].assetId);
    if (logo) db().prepare("UPDATE assets SET metadata_json = ? WHERE id = ?").run(JSON.stringify({ ...logo.metadata, role: "logo", source: "website", rights: "unconfirmed" }), logo.id);
  }
}

/** Map sampled website colours onto the composition palette with readable contrast. */
export function paletteFromSite(c: { bg: string; fg: string; accent: string | null; others: string[] }, theme: string | null): Record<string, string> {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const light = lum(c.bg) > 0.5;
  const accent = c.accent ?? theme ?? c.others[0] ?? "#c97a55";
  const darkCandidates = [theme, c.accent, ...c.others, c.fg].filter((x): x is string => !!x && /^#[0-9a-f]{6}$/i.test(x) && lum(x) < 0.25);
  const surface = darkCandidates[0] ?? "#151515";
  return {
    bg: light ? c.bg : "#f7f5f0",
    fg: light ? (lum(c.fg) < 0.3 ? c.fg : "#151515") : surface,
    accent,
    accent2: c.others.find((x) => x !== accent) ?? accent,
    surface,
    onSurface: "#ffffff",
  };
}

/** Produce the plan: AI Director in the worker, or the free recipe planner right now. */
function planNow(productionId: string): void {
  const row = getRow(productionId)!;
  const intent = json<ProductionIntent>(row.intent_json, null as never);
  const project = getProject(row.project_id)!;
  const recipe = getRecipe(intent.recipeId) ?? RECIPES[0];
  if (intent.planner === "ai") {
    const planId = queuePlan(project.id, intent.prompt, recipeConstraints(recipe, intent));
    touch(productionId, { status: "planning", plan_id: planId });
    return;
  }
  const plan = recipePlan(intent, plannerFacts(project));
  const planId = savePlanVersion(project.id, plan, { brief: intent.prompt, source: "recipe", note: `Recipe: ${recipe.label}` });
  finishPlanning(productionId, planId);
}

function plannerFacts(project: Project) {
  const w = project.settings.website;
  const assets = listAssets(project.id);
  return {
    brandName: project.settings.brandName ?? project.name,
    claims: project.settings.verifiedClaims,
    siteLines: w ? [...w.headings, ...(w.description ? [w.description.split(/(?<=[.!؟?])\s/)[0]] : [])] : [],
    ctaText: pickCta(w?.ctas ?? []),
    tagline: w?.title.split(/\s[|–—-]\s|[|–—]/).slice(1).join(" ").trim() || undefined,
    url: project.settings.productUrl,
    productUrl: project.settings.productUrl,
    photoCount: assets.filter((a) => assetRole(a) === "photo").length,
  };
}

/** After any plan arrives: enforce the recipe, run the bounded creative-QA repair, and present the direction. */
function finishPlanning(productionId: string, planId: string): void {
  const row = getRow(productionId)!;
  const project = getProject(row.project_id)!;
  const p = getPlan(planId);
  if (!p?.plan) return;
  let plan = p.plan;
  if (!plan.recipe) plan = { ...plan, recipe: row.recipe };
  const { plan: improved, report } = improvePlan(plan, qaCtx(project));
  let finalId = planId;
  if (report.fixes.length || improved.recipe !== p.plan.recipe) {
    finalId = savePlanVersion(project.id, improved, { brief: p.brief, source: "qa", parentPlanId: planId, note: report.fixes.join(" ") });
  }
  touch(productionId, { status: "direction", plan_id: finalId, error: null });
  emit({ type: "production.direction", message: `creative direction ready: ${improved.title}`, projectId: project.id, data: { productionId, planId: finalId } });
}

function qaCtx(project: Project) {
  const w = project.settings.website;
  return { claims: project.settings.verifiedClaims, palette: project.settings.palette, siteText: w ? [w.title, w.description, ...w.headings].join(" ") : "" };
}

/* ------------------------------------ Worker tick ------------------------------------ */

let ticking = false;

/** Advance every production by looking at the runs/plans it is waiting for. Idempotent, crash-safe. */
export async function processProductions(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const rows = db().prepare("SELECT * FROM productions WHERE status IN ('researching','planning','producing')").all() as unknown as ProductionRow[];
    for (const row of rows) {
      try {
        advance(row);
      } catch (e) {
        touch(row.id, { status: "failed", error: (e as Error).message.slice(0, 1000) });
        emit({ level: "error", type: "production.failed", message: (e as Error).message, projectId: row.project_id });
      }
    }
  } finally {
    ticking = false;
  }
}

function runStatus(runId: string | null): string | null {
  if (!runId) return null;
  return (db().prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string } | undefined)?.status ?? null;
}

function advance(row: ProductionRow): void {
  if (row.status === "researching") {
    const st = runStatus(row.research_run_id);
    if (st === "completed") {
      applyResearch(row);
      planNow(row.id);
    } else if (st === "failed" || st === "cancelled") {
      // Research is an enhancement, not a requirement: plan without it and say so.
      emit({ level: "warn", type: "production.research_failed", message: "could not read the website; continuing without it", projectId: row.project_id });
      planNow(row.id);
      if (getRow(row.id)?.status === "direction") touch(row.id, { error: "Orkestr could not read your website, so this direction was written without it. Check the address, or continue as is." });
    }
    return;
  }
  if (row.status === "planning" && row.plan_id) {
    const p = getPlan(row.plan_id);
    if (p?.status === "completed" && p.plan) finishPlanning(row.id, row.plan_id);
    else if (p?.status === "completed" && !p.plan) touch(row.id, { status: "failed", error: "The AI Director returned a plan Orkestr could not read." });
    else if (p?.status === "failed") touch(row.id, { status: "failed", error: `The AI Director failed: ${p.error ?? "unknown error"}` });
    return;
  }
  if (row.status === "producing") {
    const st = runStatus(row.run_id);
    if (st === "completed") {
      touch(row.id, { status: "done" });
      emit({ type: "production.done", message: "your video is ready", projectId: row.project_id, data: { productionId: row.id } });
    } else if (st === "failed" || st === "cancelled") touch(row.id, { status: "failed", error: st === "cancelled" ? "Production was stopped." : null });
  }
}

/* ------------------------------------ Produce ------------------------------------ */

export interface ProduceInput {
  /** Confirms the on-screen lines and facts are accurate (they become verified claims). */
  confirmFacts: boolean;
  /** Confirms the user may use brand materials found on their website (logo, screenshots). */
  confirmWebsiteRights?: boolean;
  voice?: ProductionIntent["voice"];
  /** Spending the user authorises for known-price paid steps in this production. Unknown prices still ask. */
  budgetUsd?: number;
}

/** Pick build options from asset roles: no asset picking for the user. */
export function autoBuildOptions(project: Project, plan: DirectorPlan, voice: ProductionIntent["voice"], rightsOk: boolean): BuildOptions {
  const assets = listAssets(project.id);
  const usable = (a: Asset) => rightsOk || a.metadata.source !== "website";
  const photos = assets.filter((a) => assetRole(a) === "photo" && usable(a) && (a.kind === "image" || a.kind === "video")).reverse();
  const logos = assets.filter((a) => assetRole(a) === "logo" && usable(a));
  const reversed = assets.filter((a) => assetRole(a) === "logo-reversed" && usable(a));
  const music = assets.find((a) => assetRole(a) === "music");
  const arabic = /arab/i.test(plan.language);
  return {
    imagePool: photos.map((a) => a.id),
    logoAssetId: logos[0]?.id ?? reversed[0]?.id,
    logoReversedAssetId: reversed[0]?.id ?? logos[0]?.id,
    musicAssetId: music?.id,
    voiceover: plan.voiceover.needed ? (voice.kind === "elevenlabs" ? { kind: "elevenlabs", voiceId: voice.voiceId, languageCode: arabic ? "ar" : "en" } : voice) : { kind: "none" },
    whisperLanguage: arabic ? "ar" : "en",
    palette: project.settings.palette,
    direction: arabic || project.settings.website?.dir === "rtl" ? "rtl" : "ltr",
  };
}

/** Lines on screen that came from the website or the user — confirming them makes them verified claims. */
function confirmLines(project: Project, plan: DirectorPlan): void {
  const lines = plan.scenes.map((s) => s.onScreenText.replace(/\n/g, " ").trim()).filter((l) => l.length > 2);
  const merged = [...new Set([...project.settings.verifiedClaims, ...lines])].slice(0, 60);
  updateProject(project.id, { settings: { verifiedClaims: merged } as never });
}

export function produce(productionId: string, input: ProduceInput): { runId: string; notes: string[] } {
  const row = getRow(productionId);
  if (!row) throw new HttpError(404, "production not found");
  if (!row.plan_id) throw new HttpError(409, "There is no creative direction yet.");
  if (!input.confirmFacts) throw new HttpError(400, "Please confirm the text and facts are accurate before producing.");
  const p = getPlan(row.plan_id);
  if (!p?.plan) throw new HttpError(409, "The creative direction is not ready.");
  const report = reviewPlan(p.plan, {});
  const blocking = report.issues.filter((i) => i.id.startsWith("write-"));
  if (blocking.length) throw new HttpError(422, blocking.map((i) => i.message).join(" "));
  let project = getProject(row.project_id)!;
  const intent = json<ProductionIntent>(row.intent_json, null as never);
  if (input.confirmWebsiteRights !== undefined) project = updateProject(project.id, { settings: { websiteRightsConfirmed: input.confirmWebsiteRights } as never });
  if (input.budgetUsd !== undefined) {
    project = updateProject(project.id, { budgetUsd: Math.max(0, input.budgetUsd) });
    touch(row.id, { budget_usd: Math.max(0, input.budgetUsd) });
  }
  const voice = input.voice ?? intent.voice;
  touch(row.id, { intent_json: JSON.stringify({ ...intent, voice }) });
  const usesProductScreens = p.plan.scenes.some((s) => s.visualSource === "ui-capture") && !!project.settings.productUrl;
  if (usesProductScreens && !project.settings.websiteRightsConfirmed) throw new HttpError(422, "Please confirm the website is yours (or that you may use it) before Orkestr shows its screens.");
  confirmLines(project, p.plan);
  project = getProject(project.id)!;
  const opts = autoBuildOptions(project, p.plan, voice, !!project.settings.websiteRightsConfirmed);
  let workflowId = row.workflow_id;
  let notes: string[];
  if (workflowId && getWorkflow(workflowId)) {
    // Refinement: same workflow, new graph. Unchanged nodes keep their signatures and reuse cached outputs.
    const scenes = replaceStoryboard(project.id, "main", p.plan.scenes.map((s) => ({ ...s, aspect: p.plan!.deliverables[0].aspect })));
    const { graph, notes: n } = planToGraph(p.plan, project, opts, scenes.map((s) => s.id));
    const v = validateGraph(graph);
    if (!v.ok) throw new HttpError(422, `The production plan is not valid: ${v.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`);
    saveWorkflow(workflowId, { graph, name: `${p.plan.title}` });
    notes = n;
  } else {
    const r = acceptPlan(row.plan_id, opts);
    if (r.issues.some((i) => i.level === "error")) throw new HttpError(422, `The production plan is not valid: ${r.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`);
    workflowId = r.workflowId;
    notes = r.notes;
  }
  const remaining = Math.max(0, (input.budgetUsd ?? row.budget_usd ?? project.budgetUsd) - spentUsd(project.id));
  const runId = createRun(workflowId, { preauthorizedUsd: remaining });
  touch(row.id, { status: "producing", workflow_id: workflowId, run_id: runId, error: null });
  emit({ type: "production.started", message: "production started", projectId: project.id, runId, data: { productionId } });
  return { runId, notes };
}

function spentUsd(projectId: string): number {
  return (db().prepare("SELECT COALESCE(SUM(amount_usd), 0) s FROM cost_ledger WHERE project_id = ? AND kind = 'actual' AND known = 1").get(projectId) as { s: number }).s;
}

/** True when every on-screen line of the plan is already a confirmed fact (so a re-render states nothing new). */
export function textAlreadyConfirmed(project: Project, plan: DirectorPlan): boolean {
  const claims = new Set(project.settings.verifiedClaims.map((c) => c.trim()));
  return plan.scenes.map((s) => s.onScreenText.replace(/\n/g, " ").trim()).filter((l) => l.length > 2).every((l) => claims.has(l));
}

/* ------------------------------------ Refine ------------------------------------ */

const claude = new ClaudeAdapter();

export interface RefineResult {
  planId: string;
  summary: string;
  changes: string[];
  ops: EditOp[];
  /** True when the request needed the AI Director and it was used (cost recorded). */
  usedAi: boolean;
  /** True when the change was applied and a new render started (only after the first production). */
  rerendering: boolean;
}

/**
 * Apply a natural-language change. Common requests are parsed deterministically (free, instant); creative
 * rewrites go to the AI Director only when `allowAi` is set — that call has an unknown price, so the UI asks.
 */
export async function refine(productionId: string, input: { instruction?: string; ops?: EditOp[]; allowAi?: boolean }): Promise<RefineResult> {
  const row = getRow(productionId);
  if (!row?.plan_id) throw new HttpError(409, "There is nothing to refine yet.");
  const cur = getPlan(row.plan_id);
  if (!cur?.plan) throw new HttpError(409, "The current plan is not ready.");
  let ops: EditOp[] = input.ops ?? [];
  let summary = "";
  let usedAi = false;
  if (!ops.length && input.instruction) {
    const parsed = needsAi(input.instruction) && input.allowAi ? null : parseInstruction(input.instruction, cur.plan);
    if (parsed) {
      ops = parsed.ops;
      summary = parsed.summary;
    } else if (input.allowAi && claudeReady()) {
      const r = await aiEdits(row.project_id, cur.plan, input.instruction);
      ops = r.ops;
      summary = r.summary;
      usedAi = true;
    } else {
      throw new HttpError(
        422,
        claudeReady()
          ? "This change needs the AI Director to rewrite the copy. Ask again with “Use AI Director” (billed to your Claude plan)."
          : "Orkestr could not turn that into a change without the AI Director, which is not set up. Try e.g. “make it 15 seconds”, “slower”, “bigger text”, “change the call to action to \"Book now\"”, or edit a scene's text directly.",
      );
    }
  }
  if (!ops.length) throw new HttpError(400, "Nothing to change.");
  let next: DirectorPlan;
  let changes: string[];
  try {
    ({ plan: next, changes } = applyEdits(cur.plan, ops));
  } catch (e) {
    if (e instanceof EditError) throw new HttpError(422, e.message);
    throw e;
  }
  const project = getProject(row.project_id)!;
  const { plan: improved, report } = improvePlan(next, qaCtx(project));
  const planId = savePlanVersion(row.project_id, improved, { brief: input.instruction ?? summary, source: "edit", parentPlanId: row.plan_id, note: [summary, ...changes, ...report.fixes].filter(Boolean).join(" ") });
  touch(row.id, { plan_id: planId });
  emit({ type: "production.refined", message: summary || changes.join(" "), projectId: row.project_id, data: { productionId, planId } });
  let rerendering = false;
  // After a first production, a change re-renders right away (cached work is reused, approvals still apply) —
  // but only when every line on screen is one the person already confirmed. New or AI-written copy always goes
  // back to the direction for review: Orkestr never confirms facts on the person's behalf.
  const textOk = !usedAi && textAlreadyConfirmed(project, improved);
  const produced = !!row.workflow_id && (row.status === "done" || row.status === "producing" || row.status === "failed");
  if (produced) {
    // The cut in progress (or waiting for approval) is now outdated: stop it so nobody approves the old version.
    const st = runStatus(row.run_id);
    if (st && ["queued", "running", "waiting_approval"].includes(st)) {
      const { requestCancel } = await import("./engine/engine");
      requestCancel(row.run_id!);
    }
  }
  if (produced && !textOk) touch(row.id, { status: "direction", error: "The on-screen text changed. Check it, then press Make it to re-render (unchanged parts are reused)." });
  else if (produced) {
    try {
      produce(productionId, { confirmFacts: true });
      rerendering = true;
    } catch (e) {
      // Leave the new version as the direction to review (e.g. it needs a line from the user).
      touch(row.id, { status: "direction", error: (e as Error).message.slice(0, 500) });
    }
  } else touch(row.id, { status: "direction" });
  return { planId, summary: summary || changes.join(" "), changes, ops, usedAi, rerendering };
}

async function aiEdits(projectId: string, plan: DirectorPlan, instruction: string): Promise<{ ops: EditOp[]; summary: string }> {
  const project = getProject(projectId)!;
  const system = `You edit a video production plan by emitting structured edit operations. You never output a full plan,
code or commands. Scene numbers are 1-based. Keep every product statement within the verified claims; never invent numbers,
testimonials or features. Keep on-screen text short (max ~6 words, 40 characters). Respond in the plan's language.`;
  const prompt = [
    `# Request\n${instruction}`,
    `# Current plan (JSON)\n${JSON.stringify({ title: plan.title, language: plan.language, tone: plan.tone, deliverables: plan.deliverables, cta: plan.cta, style: plan.style, scenes: plan.scenes.map((s, i) => ({ n: i + 1, role: s.role, durationS: s.durationS, onScreenText: s.onScreenText, narration: s.narration, visualSource: s.visualSource })) })}`,
    `# Verified claims\n${project.settings.verifiedClaims.map((c) => `- ${c}`).join("\n") || "- (none)"}`,
    "Return the operations and a one-sentence summary of what you changed.",
  ].join("\n\n");
  const res = await claude.structured({ system, prompt, schema: EditOpsSchema, model: getSettings().directorModel ?? DEFAULT_MODEL, maxBudgetUsd: Math.min(1, getSettings().directorMaxUsd), timeoutMs: 5 * 60_000 });
  recordCost({ projectId, provider: "claude", operation: "ai.edit", kind: "actual", amountUsd: res.costUsd, known: res.costUsd !== null, tokensIn: res.tokensIn, tokensOut: res.tokensOut, note: `refine (${res.model})` });
  return { ops: res.data.ops, summary: res.data.summary };
}

/** Restore an earlier version: becomes the current direction (and re-renders, mostly from cache). */
export function restoreVersion(productionId: string, planId: string): { planId: string; rerendering: boolean } {
  const row = getRow(productionId);
  const p = getPlan(planId);
  if (!row || !p?.plan || p.project_id !== row.project_id) throw new HttpError(404, "version not found");
  const id = savePlanVersion(row.project_id, p.plan, { brief: p.brief, source: "restore", parentPlanId: row.plan_id, note: `Restored the version from ${new Date(p.created_at).toLocaleString()}` });
  touch(row.id, { plan_id: id });
  if (row.workflow_id && textAlreadyConfirmed(getProject(row.project_id)!, p.plan)) {
    try {
      produce(productionId, { confirmFacts: true });
      return { planId: id, rerendering: true };
    } catch (e) {
      touch(row.id, { status: "direction", error: (e as Error).message.slice(0, 500) });
    }
  } else touch(row.id, { status: "direction" });
  return { planId: id, rerendering: false };
}

/** Recovery: retry what failed (completed work is kept), or re-plan when the plan step failed. */
export function recover(productionId: string): { action: string } {
  const row = getRow(productionId);
  if (!row) throw new HttpError(404, "production not found");
  if (row.run_id && ["failed", "cancelled"].includes(runStatus(row.run_id) ?? "")) {
    retryFailed(row.run_id);
    touch(row.id, { status: "producing", error: null });
    return { action: "retrying the steps that failed; finished work is kept" };
  }
  if (!row.plan_id || getPlan(row.plan_id)?.status === "failed") {
    const intent = json<ProductionIntent>(row.intent_json, null as never);
    // Fall back to the free planner if the AI Director is unavailable now.
    if (intent.planner === "ai" && !claudeReady()) touch(row.id, { intent_json: JSON.stringify({ ...intent, planner: "recipe" }) });
    planNow(row.id);
    return { action: "planning again" };
  }
  touch(row.id, { status: "direction", error: null });
  return { action: "back to the creative direction" };
}

/* ------------------------------------ Read model ------------------------------------ */

const STAGES: { id: string; label: string; types: string[] }[] = [
  { id: "capture", label: "Capturing your product", types: ["image.capture", "video.capture", "web.inspect"] },
  { id: "assets", label: "Preparing brand assets", types: ["production.import", "image.grade", "image.rasterize"] },
  { id: "voice", label: "Recording the voiceover", types: ["audio.voiceover", "audio.tts_local", "audio.normalize", "logic.text"] },
  { id: "captions", label: "Writing captions", types: ["audio.transcribe"] },
  { id: "render", label: "Rendering", types: ["production.compose", "production.loop", "video.loop", "image.poster", "production.concat", "video.encode", "production.mix"] },
  { id: "qa", label: "Checking quality", types: ["production.qa"] },
  { id: "approve", label: "Waiting for your OK", types: ["logic.approval"] },
  { id: "export", label: "Exporting", types: ["production.export"] },
];

const FRIENDLY_ERRORS: Record<string, string> = {
  NOT_AVAILABLE: "A tool this step needs is not available on this machine.",
  NOT_CONFIGURED: "A service this step needs is not set up yet (Settings).",
  AUTH: "A service rejected its credentials; check the API key in Settings.",
  INVALID_INPUT: "This step got input it could not use.",
  TIMEOUT: "This step took too long.",
  RATE_LIMIT: "A provider is rate-limiting requests; retrying later usually works.",
  QUOTA: "A provider says your quota or credits are used up.",
  PROVIDER: "A provider had a temporary problem.",
  TOOL_FAILED: "A local tool failed while working.",
  INVALID_OUTPUT: "A tool produced an unusable result.",
  UNSUPPORTED: "This operation is not supported here.",
};

type QaReportFile = { pass: boolean; checks: { name: string; pass: boolean; severity: string; expected?: unknown; actual?: unknown; message?: string }[] };

export interface Deliverable {
  name: string;
  aspect: string;
  kind: "video" | "image";
  assetId: string | null;
  posterAssetId: string | null;
  status: "pending" | "rendering" | "ready" | "approved" | "failed";
  exportedFiles: string[];
  qa: { pass: boolean; issues: CreativeIssue[] } | null;
}

export interface WorkspaceView {
  production: {
    id: string;
    status: ProductionStatus;
    recipe: { id: string; label: string } | null;
    intent: ProductionIntent;
    error: string | null;
    createdAt: number;
    updatedAt: number;
  } | null;
  plan: (DirectorPlan & { id: string; source: string; note: string }) | null;
  planStatus: string | null;
  creative: CreativeReport | null;
  stages: { id: string; label: string; state: "todo" | "active" | "done" | "failed" | "waiting"; done: number; total: number }[];
  progress: { done: number; total: number } | null;
  deliverables: Deliverable[];
  approvals: ApprovalView[];
  costs: { spentUsd: number; unknownCount: number; budgetUsd: number; remainingUsd: number; paidSteps: { label: string; known: boolean; usd: number | null }[] };
  recovery: { message: string; action: "retry" | "replan" | "settings" | null; detail?: string } | null;
  versions: { id: string; source: string; note: string; createdAt: number; title: string; current: boolean }[];
  website: Project["settings"]["website"] | null;
  websiteRightsConfirmed: boolean;
  logoFromWebsite: string | null;
  canUseAi: boolean;
  voiceOptions: { elevenlabs: boolean; defaultVoiceId: string | null; takes: { id: string; label: string }[] };
  /** A licensed music track is in the library (otherwise a no-voice cut is silent). */
  hasMusic: boolean;
  productUrl: string | null;
  nextAction: { kind: "wait" | "review-direction" | "approve" | "export" | "recover" | "start"; label: string };
}

export function workspace(projectId: string): WorkspaceView | undefined {
  const project = getProject(projectId);
  if (!project) return undefined;
  const row = latestProduction(project.id);
  const p = row?.plan_id ? getPlan(row.plan_id) : undefined;
  const plan = p?.plan ? { ...p.plan, id: p.id, source: p.source, note: p.note } : null;
  const intent = row ? json<ProductionIntent>(row.intent_json, null as never) : null;
  const creative = plan ? reviewPlan(plan, qaCtx(project)) : null;
  if (creative && p?.source === "qa") creative.fixes = p.note ? p.note.split(/(?<=\.)\s+/) : [];

  // Run state for stages, deliverables and approvals.
  const runId = row?.run_id ?? null;
  const graph = runId ? json<Graph>((db().prepare("SELECT graph_json FROM runs WHERE id = ?").get(runId) as { graph_json: string } | undefined)?.graph_json, { version: 1, nodes: [], edges: [] }) : null;
  const nodeRuns = runId ? (db().prepare("SELECT node_id, node_type, status, outputs_json, error_json FROM node_runs WHERE run_id = ?").all(runId) as { node_id: string; node_type: string; status: string; outputs_json: string; error_json: string | null }[]) : [];
  const byNode = new Map(nodeRuns.map((n) => [n.node_id, n]));
  const stages = STAGES.map((s) => {
    const ns = nodeRuns.filter((n) => s.types.includes(n.node_type));
    const done = ns.filter((n) => ["completed", "skipped"].includes(n.status)).length;
    const state: "todo" | "active" | "done" | "failed" | "waiting" = ns.some((n) => n.status === "failed")
      ? "failed"
      : ns.some((n) => n.status === "waiting_approval")
        ? "waiting"
        : ns.length && done === ns.length
          ? "done"
          : ns.some((n) => ["running", "queued"].includes(n.status))
            ? "active"
            : "todo";
    return { id: s.id, label: s.label, state, done, total: ns.length };
  }).filter((s) => s.total > 0);
  const total = nodeRuns.length;
  const doneCount = nodeRuns.filter((n) => ["completed", "skipped"].includes(n.status)).length;

  const outAsset = (nodeId: string, port: string) => json<Record<string, { assetId?: string }[]>>(byNode.get(nodeId)?.outputs_json, {})[port]?.find((v) => v.assetId)?.assetId ?? null;
  const deliverables: Deliverable[] = (plan?.deliverables ?? []).map((d, di) => {
    const suffix = di === 0 ? "" : `_${di + 1}`;
    const kind = graph?.nodes.find((n) => n.id === `poster${suffix}`) ? "image" : "video";
    const producer = ["compose", "loop", "poster"].map((x) => `${x}${suffix}`).find((id) => byNode.has(id));
    const assetId = producer ? outAsset(producer, kind === "image" ? "image" : "video") : null;
    const qaRow = byNode.get(`qa${suffix}`);
    const qaVal = qaRow ? json<Record<string, { assetId?: string; value?: unknown }[]>>(qaRow.outputs_json, {}).report?.[0] : undefined;
    let qaReport = null as QaReportFile | null;
    if (qaVal?.assetId) {
      const a = getAsset(qaVal.assetId);
      if (a) qaReport = json<QaReportFile | null>(fs.existsSync(a.path) ? fs.readFileSync(a.path, "utf8") : null, null);
    }
    const exp = byNode.get(`export${suffix}`);
    const files = exp ? (json<Record<string, { value?: { files?: { exportedTo: string }[] } }[]>>(exp.outputs_json, {}).asset?.[0]?.value?.files ?? []).map((f) => f.exportedTo.split(/[\\/]/).pop()!) : [];
    const prodStatus = producer ? byNode.get(producer)!.status : "pending";
    const status: Deliverable["status"] = exp?.status === "completed" ? "approved" : prodStatus === "completed" ? "ready" : prodStatus === "failed" ? "failed" : ["running", "queued"].includes(prodStatus) ? "rendering" : "pending";
    return {
      name: d.name,
      aspect: d.aspect,
      kind,
      assetId,
      posterAssetId: null,
      status,
      exportedFiles: files,
      qa: qaReport ? { pass: qaReport.pass, issues: technicalIssues(qaReport, d.name) } : null,
    };
  });
  const approvals = runId ? listApprovals({ runId, status: "pending" }) : [];

  // Costs: actual known spend, unknown-price calls, and the paid steps the current graph contains.
  const spent = spentUsd(project.id);
  const unknownCount = (db().prepare("SELECT COUNT(*) c FROM cost_ledger WHERE project_id = ? AND kind = 'actual' AND known = 0").get(project.id) as { c: number }).c;
  const paidSteps = graph ? graph.nodes.filter((n) => n.type === "audio.voiceover").map((n) => ({ label: n.label ?? "Voiceover (ElevenLabs)", known: false, usd: null })) : [];
  const budget = row?.budget_usd ?? project.budgetUsd;

  // Recovery: plain language, one action.
  let recovery: WorkspaceView["recovery"] = null;
  if (row?.status === "failed") {
    const failed = nodeRuns.find((n) => n.status === "failed");
    const err = failed ? json<{ code: string; message: string; retryable?: boolean } | null>(failed.error_json, null) : null;
    if (err?.code === "REJECTED") {
      recovery = { message: "You asked for changes to this cut. Describe them in Refine and only the affected parts are re-made, or try again as it is.", action: "retry" };
    } else if (err) {
      const settingsFix = ["NOT_CONFIGURED", "AUTH", "QUOTA", "NOT_AVAILABLE"].includes(err.code);
      recovery = { message: `${STAGES.find((s) => s.types.includes(failed!.node_type))?.label ?? "A step"} failed. ${FRIENDLY_ERRORS[err.code] ?? ""} Everything that finished is kept.`, action: settingsFix ? "settings" : "retry", detail: err.message };
    } else recovery = { message: row.error ?? "Something went wrong. Your work so far is kept.", action: row.plan_id && getPlan(row.plan_id)?.status !== "failed" ? "retry" : "replan", detail: row.error ?? undefined };
  } else if (row?.status === "direction" && row.error) recovery = { message: row.error, action: null };

  const versions = row
    ? (db()
        .prepare("SELECT id, source, note, created_at, plan_json, status FROM plans WHERE project_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 12")
        .all(project.id) as { id: string; source: string; note: string; created_at: number; plan_json: string; status: string }[]).map((v) => ({
        id: v.id,
        source: v.source,
        note: v.note,
        createdAt: v.created_at,
        title: (json<{ title?: string }>(v.plan_json, {}).title ?? "").slice(0, 120),
        current: v.id === row.plan_id,
      }))
    : [];
  const logo = listAssets(project.id).find((a) => assetRole(a) === "logo" && a.metadata.source === "website");
  const reg = loadRegistry();
  const elevenReady = !!reg?.tools.find((t) => t.id === "elevenlabs")?.capabilities.find((c) => c.id === "elevenlabs.tts")?.ready;

  const nextAction: WorkspaceView["nextAction"] = !row
    ? { kind: "start", label: "Describe what you want to create" }
    : row.status === "failed"
      ? { kind: "recover", label: "Something needs attention" }
      : row.status === "direction"
        ? { kind: "review-direction", label: "Review the creative direction" }
        : approvals.length
          ? { kind: "approve", label: approvals.length === 1 ? "One decision needs you" : `${approvals.length} decisions need you` }
          : row.status === "done"
            ? { kind: "export", label: "Your video is ready" }
            : { kind: "wait", label: row.status === "researching" ? "Reading your website" : row.status === "planning" ? "Writing the creative direction" : "Producing" };

  return {
    production: row && intent ? { id: row.id, status: row.status, recipe: getRecipe(row.recipe) ? { id: row.recipe, label: getRecipe(row.recipe)!.label } : null, intent, error: row.error, createdAt: row.created_at, updatedAt: row.updated_at } : null,
    plan,
    planStatus: p?.status ?? null,
    creative,
    stages,
    progress: total ? { done: doneCount, total } : null,
    deliverables,
    approvals,
    costs: { spentUsd: spent, unknownCount, budgetUsd: budget, remainingUsd: Math.max(0, budget - spent), paidSteps },
    recovery,
    versions,
    website: project.settings.website ?? null,
    websiteRightsConfirmed: !!project.settings.websiteRightsConfirmed,
    logoFromWebsite: logo?.id ?? null,
    canUseAi: claudeReady(),
    hasMusic: listAssets(project.id).some((a) => assetRole(a) === "music"),
    productUrl: project.settings.productUrl ?? null,
    voiceOptions: { elevenlabs: elevenReady, defaultVoiceId: getSettings().defaultVoiceId, takes: listAssets(project.id).filter((a) => assetRole(a) === "voiceover").map((a) => ({ id: a.id, label: a.label })) },
    nextAction,
  };
}

/** Update a scene's text inline (direction review). Free; a re-render follows only on produce. */
export function editScene(productionId: string, scene: number, field: "onScreenText" | "narration", value: string) {
  return refine(productionId, { ops: [{ op: "setSceneText", scene, field, value }] });
}

/** Readiness summary for onboarding: what works now, what is optional, what a request would need. */
export function readiness() {
  const ready = readyCapabilities();
  const reg = loadRegistry();
  const has = (c: string) => ready.has(c);
  const core = [
    { id: "render", label: "Video rendering", ok: has("remotion.render") && has("ffmpeg.encode"), fix: "Install FFmpeg and run tool discovery (Settings → Tools)." },
    { id: "capture", label: "Product screens from your website", ok: has("playwright.screenshot"), fix: "Run `npx playwright install chromium`." },
  ];
  const optional = [
    { id: "ai", label: "AI Director (writes scripts and direction)", ok: has("claude.plan"), why: "Without it, Orkestr uses its free recipe planner and your own words.", fix: "Install and log in to Claude Code (`claude`)." },
    { id: "voice", label: "AI voiceover (ElevenLabs, paid)", ok: has("elevenlabs.tts"), why: "Without it, use your own recorded voice or captions only.", fix: "Add an ElevenLabs API key in Settings → Credentials." },
    { id: "captions", label: "Automatic captions (Whisper)", ok: has("whisper.transcribe"), why: "Captions are made from the voiceover.", fix: "Settings → Tools → Install Whisper." },
  ];
  const notAvailable = ["AI image generation", "AI video generation", "AI music"].map((label) => ({ label, why: "No verified provider on this machine; Orkestr uses real product screens, your photos and motion graphics instead." }));
  return { ready: core.every((c) => c.ok), core, optional, notAvailable, checkedAt: reg?.generatedAt ?? null };
}

export { RECIPES };
