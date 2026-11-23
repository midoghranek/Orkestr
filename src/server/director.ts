import type { DirectorPlan, Graph, GraphEdge, GraphNode, Aspect } from "@/shared/schema";
import { ASPECT_SIZES, DirectorPlanSchema } from "@/shared/schema";
import { ClaudeAdapter, DEFAULT_MODEL } from "./adapters/claude";
import { loadRegistry, readyCapabilities } from "./adapters/registry";
import { getDb, json } from "./db";
import { newId } from "./util/ids";
import { recordCost } from "./costs";
import { emit } from "./events";
import { getProject, replaceStoryboard, createWorkflow, type Project } from "./projects";
import { listAssets, type Asset } from "./assets";
import { getSettings } from "./settings";
import { validateGraph } from "./engine/validate";

const claude = new ClaudeAdapter();

const SYSTEM = `You are the Creative Director of Orkestr, a local AI production studio.
You turn a client brief into a precise, producible plan: script, storyboard and shot list.

Hard rules:
- Use ONLY the product facts listed under "Verified claims". Never invent features, prices, numbers or customers.
- Plan only with the tools listed as READY. If a scene would need an unavailable tool (e.g. AI video generation),
  choose a producible alternative (brand photography, real UI capture, motion graphics) or set visualSource
  to "placeholder" and say so in "risks".
- Real product UI must come from "ui-capture" scenes (captured from the live product), never imagined screens.
- Scene durations must add up to the main deliverable's duration (±0.5 s).
- Narration must fit the scene durations at a natural pace (Egyptian Arabic ≈ 2.3 words/second).
- Ask at most 3 questions, only if something essential is missing. Otherwise leave "questions" empty.
- You only propose. You never execute anything.`;

export interface DirectorResult {
  plan: DirectorPlan;
  costUsd: number | null;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export function capabilityBrief(): string {
  const reg = loadRegistry();
  const ready: string[] = [];
  const blocked: string[] = [];
  for (const t of reg?.tools ?? [])
    for (const c of t.capabilities) (c.ready ? ready : blocked).push(`- ${c.id}: ${c.label}${c.ready ? "" : ` — NOT AVAILABLE (${c.blockedReason ?? "not ready"})`}${c.limitations?.length ? ` [limits: ${c.limitations.join("; ")}]` : ""}`);
  const missing = (reg?.unavailable ?? []).map((u) => `- ${u.name}: NOT AVAILABLE (${u.reason}) — would enable ${u.enables}`);
  return `READY tools:\n${ready.join("\n") || "- (none)"}\n\nUnavailable:\n${[...blocked, ...missing].join("\n")}`;
}

export function assetBrief(assets: Asset[]): string {
  return assets
    .filter((a) => a.kind === "image" || a.kind === "video" || a.kind === "audio")
    .slice(0, 60)
    .map((a) => `- [${a.id}] ${a.kind} "${a.label}"${a.width ? ` ${a.width}x${a.height}` : ""}${a.durationS ? ` ${a.durationS.toFixed(1)}s` : ""}${a.metadata.note ? ` — ${String(a.metadata.note)}` : ""}`)
    .join("\n");
}

export async function directorPlan(input: { brief: string; constraints?: string; project?: Project; model?: string; maxBudgetUsd?: number; signal?: AbortSignal }): Promise<DirectorResult> {
  const p = input.project;
  const assets = p ? listAssets(p.id) : [];
  const prompt = [
    `# Brief\n${input.brief}`,
    input.constraints ? `# Constraints\n${input.constraints}` : "",
    p
      ? `# Project\nName: ${p.name}\nBrand: ${p.settings.brandName ?? p.name}${p.settings.brandPronunciation ? ` (pronounced «${p.settings.brandPronunciation}» in narration)` : ""}\nLanguage: ${p.settings.language ?? "unspecified"}\nProduct URL (for ui-capture): ${p.settings.productUrl ?? "none"}\n${p.settings.brandNotes ?? ""}`
      : "",
    `# Verified claims\n${p?.settings.verifiedClaims.map((c) => `- ${c}`).join("\n") || "- (none provided: keep product claims generic and say so in risks)"}`,
    `# Library assets you may reference by id in scene.references\n${assetBrief(assets) || "- (none)"}`,
    `# Tools\n${capabilityBrief()}`,
    `Return the plan.`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const res = await claude.structured({
    system: SYSTEM,
    prompt,
    schema: DirectorPlanSchema,
    model: input.model ?? getSettings().directorModel ?? DEFAULT_MODEL,
    maxBudgetUsd: input.maxBudgetUsd ?? getSettings().directorMaxUsd,
    signal: input.signal,
    timeoutMs: 15 * 60_000,
  });
  return { plan: res.data, costUsd: res.costUsd, tokensIn: res.tokensIn, tokensOut: res.tokensOut, model: res.model };
}

/* --------------------------- Plan jobs (run by the worker) --------------------------- */

export function queuePlan(projectId: string, brief: string): string {
  const id = newId("pln");
  getDb().prepare("INSERT INTO plans (id, project_id, brief, status, created_at) VALUES (?, ?, ?, 'queued', ?)").run(id, projectId, brief, Date.now());
  emit({ type: "plan.queued", message: "AI Director plan queued", projectId });
  return id;
}

export interface PlanRow {
  id: string;
  project_id: string;
  brief: string;
  status: "queued" | "running" | "completed" | "failed";
  plan_json: string | null;
  error: string | null;
  model: string | null;
  cost_usd: number | null;
  created_at: number;
  finished_at: number | null;
}

let planRunning = false;

/** Worker hook: process one queued plan at a time. Plans left 'running' by a crash are re-queued at startup. */
export async function processPlans(): Promise<void> {
  if (planRunning) return;
  const db = getDb();
  const row = db.prepare("SELECT * FROM plans WHERE status='queued' ORDER BY created_at LIMIT 1").get() as PlanRow | undefined;
  if (!row) return;
  const claimed = db.prepare("UPDATE plans SET status='running' WHERE id=? AND status='queued'").run(row.id);
  if (claimed.changes !== 1) return;
  planRunning = true;
  const project = getProject(row.project_id);
  try {
    emit({ type: "plan.started", message: "AI Director is planning", projectId: row.project_id });
    const res = await directorPlan({ brief: row.brief, project });
    recordCost({ projectId: row.project_id, provider: "claude", operation: "ai.director", kind: "actual", amountUsd: res.costUsd, known: res.costUsd !== null, tokensIn: res.tokensIn, tokensOut: res.tokensOut, note: `plan ${row.id} (${res.model})` });
    db.prepare("UPDATE plans SET status='completed', plan_json=?, model=?, cost_usd=?, finished_at=? WHERE id=?").run(JSON.stringify(res.plan), res.model, res.costUsd, Date.now(), row.id);
    emit({ type: "plan.completed", message: `plan ready: ${res.plan.title} (${res.plan.scenes.length} scenes)`, projectId: row.project_id, data: { planId: row.id, costUsd: res.costUsd } });
  } catch (e) {
    db.prepare("UPDATE plans SET status='failed', error=?, finished_at=? WHERE id=?").run((e as Error).message.slice(0, 2000), Date.now(), row.id);
    emit({ level: "error", type: "plan.failed", message: `AI Director failed: ${(e as Error).message}`, projectId: row.project_id });
  } finally {
    planRunning = false;
  }
}

export function requeueStalePlans(): void {
  getDb().prepare("UPDATE plans SET status='queued' WHERE status='running'").run();
}

export function getPlan(id: string): (PlanRow & { plan: DirectorPlan | null }) | undefined {
  const r = getDb().prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | undefined;
  return r ? { ...r, plan: r.plan_json ? DirectorPlanSchema.parse(json(r.plan_json, null)) : null } : undefined;
}

export function listPlans(projectId: string): (PlanRow & { plan: DirectorPlan | null })[] {
  return (getDb().prepare("SELECT * FROM plans WHERE project_id = ? ORDER BY created_at DESC LIMIT 20").all(projectId) as unknown as PlanRow[]).map((r) => ({
    ...r,
    plan: r.plan_json ? (DirectorPlanSchema.safeParse(json(r.plan_json, null)).data ?? null) : null,
  }));
}

/* --------------------------- Plan → graph (deterministic) --------------------------- */

export interface BuildOptions {
  /** Library assets to use for brand-asset/placeholder scenes, matched by id in scene.references or in order. */
  imagePool?: string[];
  logoAssetId?: string;
  logoReversedAssetId?: string;
  musicAssetId?: string;
  /** Voiceover source: existing asset, ElevenLabs (paid), or none. */
  voiceover?: { kind: "asset"; assetId: string } | { kind: "elevenlabs"; voiceId: string; modelId?: string; languageCode?: string } | { kind: "none" };
  whisperLanguage?: string;
  palette?: Record<string, string>;
  direction?: "rtl" | "ltr";
}

class GraphBuilder {
  nodes: GraphNode[] = [];
  edges: GraphEdge[] = [];
  private col = new Map<number, number>();
  add(type: string, id: string, params: Record<string, unknown>, column: number, label?: string, sceneId?: string): string {
    const row = this.col.get(column) ?? 0;
    this.col.set(column, row + 1);
    this.nodes.push({ id, type, label, params, position: { x: column * 300, y: row * 140 }, ...(sceneId ? { sceneId } : {}) });
    return id;
  }
  link(source: string, sourceHandle: string, target: string, targetHandle: string): void {
    this.edges.push({ id: `e${this.edges.length + 1}`, source, sourceHandle, target, targetHandle });
  }
  graph(meta: Record<string, unknown>): Graph {
    return { version: 1, nodes: this.nodes, edges: this.edges, meta };
  }
}

export function planToGraph(plan: DirectorPlan, project: Project, opts: BuildOptions, sceneIds: string[] = []): { graph: Graph; notes: string[] } {
  const ready = readyCapabilities();
  const notes: string[] = [];
  const b = new GraphBuilder();
  const pool = [...(opts.imagePool ?? [])];
  const usedPool = new Set<string>();
  const nextPool = () => {
    const free = pool.find((p) => !usedPool.has(p)) ?? pool[0];
    if (free) usedPool.add(free);
    return free;
  };
  const main = plan.deliverables[0];
  const aspect = main.aspect as Aspect;
  const size = ASPECT_SIZES[aspect];

  // 1) Scene visuals
  const visualIds: (string | null)[] = [];
  plan.scenes.forEach((s, i) => {
    const id = `scene${i + 1}`;
    const sceneId = sceneIds[i];
    const refAsset = s.references.find((r) => /^ast_/.test(r) && pool.includes(r)) ?? s.references.find((r) => /^ast_/.test(r));
    if (s.visualSource === "ui-capture" && project.settings.productUrl && ready.has("playwright.screenshot")) {
      const mobile = aspect === "9:16";
      b.add("image.capture", id, { url: project.settings.productUrl, width: mobile ? 430 : 1440, height: mobile ? 932 : 900, deviceScaleFactor: 2, mobile, locale: "ar-EG", scrollTo: Math.round(i * 600) }, 0, `UI · ${s.title}`, sceneId);
      visualIds.push(id);
    } else if (s.visualSource === "motion-graphics") {
      visualIds.push(null);
    } else {
      const assetId = refAsset ?? nextPool();
      if (!assetId) {
        visualIds.push(null);
        notes.push(`Scene ${i + 1} "${s.title}": no visual available — rendered as a title card.`);
        return;
      }
      const placeholder = s.visualSource === "generated-video" || s.visualSource === "generated-image" || s.visualSource === "stock" || s.visualSource === "placeholder";
      if (placeholder) notes.push(`Scene ${i + 1} "${s.title}": wants ${s.visualSource}, which is not available — using library asset ${assetId} as a marked placeholder.`);
      b.add("production.import", id, { assetId, label: placeholder ? "placeholder" : undefined }, 0, `${placeholder ? "Placeholder" : "Brand"} · ${s.title}`, sceneId);
      visualIds.push(id);
    }
  });

  // 2) Audio
  let voNode: string | null = null;
  const narration = plan.scenes.map((s) => s.narration).filter(Boolean).join(" ");
  const vo = opts.voiceover ?? { kind: "none" as const };
  if (vo.kind === "asset") {
    voNode = b.add("production.import", "voiceover", { assetId: vo.assetId }, 1, "Voiceover (approved take)");
  } else if (vo.kind === "elevenlabs" && narration) {
    if (ready.has("elevenlabs.tts")) {
      b.add("logic.text", "script", { text: narration }, 1, "Narration script");
      voNode = b.add("audio.voiceover", "voiceover", { voiceId: vo.voiceId, modelId: vo.modelId ?? "eleven_multilingual_v2", languageCode: vo.languageCode }, 1, "Voiceover (ElevenLabs)");
      b.link("script", "text", "voiceover", "script");
      b.add("logic.approval", "vo_review", { title: "Listen: Egyptian Arabic pronunciation", instructions: `Check that the brand is pronounced «${project.settings.brandPronunciation ?? project.settings.brandName ?? project.name}» and the delivery is natural.` }, 2, "Pronunciation review");
      b.link("voiceover", "audio", "vo_review", "in");
      voNode = "vo_review";
    } else notes.push("Voiceover requested but ElevenLabs is not configured — the cut is built without narration (captions show the script on screen instead).");
  }
  let subsNode: string | null = null;
  if (voNode && ready.has("whisper.transcribe")) {
    subsNode = b.add("audio.transcribe", "captions", { language: opts.whisperLanguage ?? "auto", maxChars: aspect === "9:16" ? 32 : 42 }, 3, "Captions (Whisper)");
    b.link(voNode, voNode === "vo_review" ? "out" : "asset", "captions", "audio");
    b.add("logic.approval", "captions_review", { title: "Review captions", instructions: "Whisper output must be proofread (dialect words, brand name) before export." }, 4, "Caption review");
    b.link("captions", "subtitles", "captions_review", "in");
    subsNode = "captions_review";
  }
  const musicNode = opts.musicAssetId ? b.add("production.import", "music", { assetId: opts.musicAssetId }, 1, "Music (licensed)") : null;
  if (!musicNode) notes.push("No licensed music track in the library — the cut has no music bed (no verified music generator is available).");
  const logo = opts.logoAssetId ? b.add("production.import", "logo", { assetId: opts.logoAssetId }, 1, "Logo") : null;
  const logoRev = opts.logoReversedAssetId ? b.add("production.import", "logo_rev", { assetId: opts.logoReversedAssetId }, 1, "Logo (reversed)") : null;

  // 3) One production branch per deliverable (aspect variants reuse every upstream node).
  // Portrait deliverables get real mobile captures of the product (desktop captures crop badly in a phone frame).
  const portraitIds = new Map<number, string>();
  const visualsFor = (a: Aspect): (string | null)[] =>
    visualIds.map((v, i) => {
      if (!v || (a !== "9:16" && a !== "4:5") || b.nodes.find((n) => n.id === v)?.type !== "image.capture") return v;
      if (!portraitIds.has(i)) {
        const src = b.nodes.find((n) => n.id === v)!;
        const id = b.add("image.capture", `${v}_m`, { ...src.params, width: 430, height: 932, deviceScaleFactor: 3, mobile: true, scrollTo: Math.round(i * 900) }, 0, `${src.label ?? v} (mobile)`, src.sceneId);
        portraitIds.set(i, id);
      }
      return portraitIds.get(i)!;
    });
  const stillsFor = (a: Aspect) => visualsFor(a).filter((v): v is string => !!v);
  const stillSources = visualIds.filter((v): v is string => !!v);
  const handleOf = (id: string) => (b.nodes.find((n) => n.id === id)?.type === "image.capture" ? "image" : "asset");
  const lastLines = (plan.scenes[plan.scenes.length - 1]?.onScreenText ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  plan.deliverables.forEach((d, di) => {
    const suffix = di === 0 ? "" : `_${di + 1}`;
    const dAspect = d.aspect as Aspect;
    const slugName = `${project.slug}-${d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${dAspect.replace(":", "x")}`;
    const kind = /poster|still/i.test(d.name) || d.durationS <= 1 ? "poster" : /loop/i.test(d.name) ? "loop" : "cut";

    if (kind === "poster") {
      const bg = stillSources.find((v) => handleOf(v) === "asset") ?? stillSources[0];
      const poster = b.add("image.poster", `poster${suffix}`, { aspect: dAspect, headline: lastLines[lastLines.length - 1] ?? plan.title, sub: lastLines.slice(1, -1).join(" · "), kicker: project.settings.brandName ?? "", direction: opts.direction ?? "rtl", palette: opts.palette }, 5, `Poster · ${d.name}`);
      if (bg) b.link(bg, handleOf(bg), poster, "background");
      if (logoRev) b.link(logoRev, "asset", poster, "logo");
      const exp = b.add("production.export", `export${suffix}`, { name: slugName, deliverable: d.name }, 8, `Export · ${d.name}`);
      b.link(poster, "image", exp, "asset");
      return;
    }

    if (kind === "loop") {
      // Text-free brand loop: stills only (videos can't feed an image port), crossfaded seamless, muted MP4 + WebM.
      const loop = b.add("production.loop", `loopcomp${suffix}`, { aspect: dAspect, durationS: d.durationS + 1, scrim: 0.15, palette: opts.palette }, 5, `Loop · ${d.name}`);
      stillsFor(dAspect).forEach((v) => b.link(v, handleOf(v), loop, "images"));
      const seamless = b.add("video.loop", `loop${suffix}`, { crossfadeS: 1, webm: true }, 6, `Seamless · ${d.name}`);
      b.link(loop, "video", seamless, "video");
      const s2 = ASPECT_SIZES[dAspect];
      const qa = b.add("production.qa", `qa${suffix}`, { expectWidth: s2.width, expectHeight: s2.height, expectFps: 30, minDurationS: d.durationS - 0.6, maxDurationS: d.durationS + 0.6, requireAudio: false }, 7, `QA · ${d.name}`);
      b.link(seamless, "video", qa, "video");
      const gate = b.add("logic.approval", `approve${suffix}`, { title: `Approve ${d.name}`, instructions: "Check the loop point (end → start) is invisible." }, 7, `Approve · ${d.name}`);
      b.link(seamless, "video", gate, "in");
      b.link(seamless, "webm", gate, "in");
      b.link(qa, "report", gate, "in");
      const exp = b.add("production.export", `export${suffix}`, { name: slugName, deliverable: d.name }, 8, `Export · ${d.name}`);
      b.link(gate, "out", exp, "asset");
      return;
    }
    const scale = d.durationS / main.durationS;
    const vis = visualsFor(dAspect);
    const scenes = plan.scenes.map((s, i) => {
      const vIndex = vis.slice(0, i + 1).filter(Boolean).length - 1;
      const isLast = i === plan.scenes.length - 1;
      return {
        id: `s${i + 1}`,
        durationS: Math.max(0.8, Math.round(s.durationS * scale * 10) / 10),
        layout: isLast ? "end-card" : vis[i] ? (s.visualSource === "ui-capture" ? "ui-showcase" : "full-bleed") : "title",
        visualIndex: vis[i] ? vIndex : undefined,
        visual: vis[i] ? undefined : null,
        headline: s.onScreenText,
        placeholder: ["generated-video", "generated-image", "stock", "placeholder"].includes(s.visualSource),
      };
    });
    const total = scenes.reduce((a, s) => a + s.durationS, 0);
    // Fix rounding drift on the last scene so the cut lands on the target length.
    scenes[scenes.length - 1].durationS = Math.max(0.8, Math.round((scenes[scenes.length - 1].durationS + (d.durationS - total)) * 10) / 10);
    const comp = b.add("production.compose", `compose${suffix}`, { aspect: dAspect, fps: 30, direction: opts.direction ?? "rtl", palette: opts.palette, scenes, showCaptions: !!subsNode, maxDurationS: d.durationS + 0.5 }, 5, `Compose · ${d.name}`);
    vis.forEach((v) => v && b.link(v, handleOf(v), comp, "visuals"));
    if (voNode && Math.abs(scale - 1) < 0.01) b.link(voNode, voNode === "vo_review" ? "out" : "asset", comp, "voiceover");
    if (musicNode) b.link(musicNode, "asset", comp, "music");
    if (subsNode && Math.abs(scale - 1) < 0.01) b.link(subsNode, "out", comp, "subtitles");
    if (logo) b.link(logo, "asset", comp, "logo");
    if (logoRev) b.link(logoRev, "asset", comp, "logo");
    if (Math.abs(scale - 1) >= 0.01 && voNode) notes.push(`"${d.name}" is a ${d.durationS}s cut: the full-length voiceover does not fit, so it is built without narration until a dedicated cut-down VO is recorded.`);
    const s2 = ASPECT_SIZES[dAspect];
    const qa = b.add("production.qa", `qa${suffix}`, { expectWidth: s2.width, expectHeight: s2.height, expectFps: 30, minDurationS: d.durationS - 0.6, maxDurationS: d.durationS + 0.6, requireAudio: !!(voNode || musicNode) }, 6, `QA · ${d.name}`);
    b.link(comp, "video", qa, "video");
    const gate = b.add("logic.approval", `approve${suffix}`, { title: `Approve ${d.name}`, instructions: "Watch the full cut and check the QA frames before export." }, 7, `Approve · ${d.name}`);
    b.link(comp, "video", gate, "in");
    b.link(qa, "report", gate, "in");
    const exp = b.add("production.export", `export${suffix}`, { name: `${project.slug}-${d.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${dAspect.replace(":", "x")}`, deliverable: d.name }, 8, `Export · ${d.name}`);
    b.link(gate, "out", exp, "asset");
  });
  void size;
  return { graph: b.graph({ planTitle: plan.title, generatedBy: "ai.director", notes }), notes };
}

/** Accept a plan: store the storyboard scenes and create a validated workflow from it. */
export function acceptPlan(planId: string, opts: BuildOptions): { workflowId: string; notes: string[]; issues: ReturnType<typeof validateGraph>["issues"] } {
  const p = getPlan(planId);
  if (!p?.plan) throw new Error("plan not ready");
  const project = getProject(p.project_id)!;
  const scenes = replaceStoryboard(project.id, "main", p.plan.scenes.map((s) => ({ ...s, aspect: p.plan!.deliverables[0].aspect })));
  const { graph, notes } = planToGraph(p.plan, project, opts, scenes.map((s) => s.id));
  const v = validateGraph(graph);
  const wf = createWorkflow(project.id, `${p.plan.title} (AI Director)`, graph, "ai.director");
  emit({ type: "plan.accepted", message: `plan accepted → workflow ${wf.name}${v.ok ? "" : " (needs fixes)"}`, projectId: project.id, data: { workflowId: wf.id, notes } });
  return { workflowId: wf.id, notes, issues: v.issues };
}
