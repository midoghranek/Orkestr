import { z } from "zod";

/** Data types flowing along graph edges. */
export const PORT_TYPES = ["text", "json", "image", "video", "audio", "subtitle", "storyboard", "any"] as const;
export type PortType = (typeof PORT_TYPES)[number];

export const RUN_STATUSES = [
  "draft",
  "validating",
  "waiting_approval",
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Node-level states: the run states plus `pending` (waiting for upstream) and `skipped` (upstream failed/cancelled). */
export const NODE_STATUSES = [...RUN_STATUSES, "pending", "skipped"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export const ASPECTS = ["16:9", "9:16", "1:1", "4:5"] as const;
export type Aspect = (typeof ASPECTS)[number];

export const ASPECT_SIZES: Record<Aspect, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

const idRe = /^[A-Za-z0-9_.-]{1,64}$/;

export const GraphNodeSchema = z.object({
  id: z.string().regex(idRe, "node id: letters, digits, _ . - (max 64)"),
  type: z.string().min(1).max(64),
  label: z.string().max(120).optional(),
  params: z.record(z.string(), z.unknown()).default({}),
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  /** Storyboard scene this node produces visuals/audio for (assets are versioned per scene). */
  sceneId: z.string().max(64).optional(),
  /** Retry policy override. */
  retry: z
    .object({ maxAttempts: z.number().int().min(1).max(10), backoffMs: z.number().int().min(0).max(600_000) })
    .partial()
    .optional(),
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  id: z.string().regex(idRe),
  source: z.string().regex(idRe),
  sourceHandle: z.string().min(1).max(64),
  target: z.string().regex(idRe),
  targetHandle: z.string().min(1).max(64),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const GraphSchema = z.object({
  version: z.literal(1).default(1),
  nodes: z.array(GraphNodeSchema).max(500),
  edges: z.array(GraphEdgeSchema).max(2000),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type Graph = z.infer<typeof GraphSchema>;

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface PortSpec {
  name: string;
  type: PortType;
  label?: string;
  /** Accept many edges (fan-in). Values arrive as an array in edge order. */
  multiple?: boolean;
  optional?: boolean;
}

export interface NodeTypeInfo {
  type: string;
  family: "ai" | "image" | "video" | "audio" | "production" | "logic";
  label: string;
  description: string;
  inputs: PortSpec[];
  outputs: PortSpec[];
  /** JSON Schema of params (derived from Zod) for the inspector. */
  paramsJsonSchema: unknown;
  defaults: Record<string, unknown>;
  /** Capability this node needs, e.g. `ffmpeg.encode`. Null for pure logic nodes. */
  capability: string | null;
  /** Whether a verified tool currently provides the capability. */
  available: boolean;
  unavailableReason?: string;
  paid: boolean;
}

/** Scene in a storyboard (shared by the AI Director plan and the storyboard view). */
export const SceneSchema = z.object({
  title: z.string().min(1).max(120),
  durationS: z.number().min(0.5).max(120),
  narration: z.string().max(2000).default(""),
  onScreenText: z.string().max(500).default(""),
  prompt: z.string().max(4000).default(""),
  camera: z.string().max(500).default(""),
  constraints: z.array(z.string().max(300)).max(20).default([]),
  references: z.array(z.string().max(300)).max(20).default([]),
  visualSource: z
    .enum(["brand-asset", "ui-capture", "motion-graphics", "generated-image", "generated-video", "stock", "placeholder"])
    .default("motion-graphics"),
  tool: z.string().max(80).default(""),
  /** Story beat this scene plays (from the recipe). Drives layout choice and creative QA. */
  role: z.enum(["hook", "problem", "ui", "benefit", "proof", "statement", "cta"]).optional(),
});
export type Scene = z.infer<typeof SceneSchema>;
export const SCENE_ROLES = ["hook", "problem", "ui", "benefit", "proof", "statement", "cta"] as const;
export type SceneRole = (typeof SCENE_ROLES)[number];

/** Look & feel knobs the user can change in plain language ("slower", "bigger text", "more cinematic"). */
export const PlanStyleSchema = z.object({
  motion: z.enum(["calm", "standard", "energetic"]).default("standard"),
  textScale: z.number().min(0.7).max(1.6).default(1),
  captions: z.boolean().default(true),
});
export type PlanStyle = z.infer<typeof PlanStyleSchema>;

/** The AI Director's structured plan. The model only proposes; Orkestr validates and builds the graph itself. */
export const DirectorPlanSchema = z.object({
  title: z.string().min(1).max(160),
  logline: z.string().max(600),
  language: z.string().max(40),
  audience: z.string().max(400),
  tone: z.string().max(200),
  deliverables: z
    .array(
      z.object({
        name: z.string().max(120),
        aspect: z.enum(ASPECTS),
        durationS: z.number().min(1).max(600),
      }),
    )
    .min(1)
    .max(8),
  script: z.string().max(8000),
  scenes: z.array(SceneSchema).min(1).max(40),
  voiceover: z.object({
    needed: z.boolean(),
    language: z.string().max(40).default(""),
    direction: z.string().max(600).default(""),
  }),
  music: z.string().max(400).default(""),
  questions: z.array(z.string().max(400)).max(5).default([]),
  risks: z.array(z.string().max(400)).max(10).default([]),
  /** Recipe the plan follows (see src/server/recipes.ts). Empty for free-form plans. */
  recipe: z.string().max(40).default(""),
  /** Call to action shown on the end card. */
  cta: z.object({ text: z.string().max(60).default(""), url: z.string().max(120).default("") }).default({ text: "", url: "" }),
  style: PlanStyleSchema.default({ motion: "standard", textScale: 1, captions: true }),
});
export type DirectorPlan = z.infer<typeof DirectorPlanSchema>;

/**
 * Structured edits to a plan. Natural-language refinements ("slower", "change the CTA", "make an Instagram
 * version") are translated into these — by a deterministic parser or by the AI — and applied by a pure function.
 * Scene numbers are 1-based, as people say them.
 */
export const EditOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("setSceneText"), scene: z.number().int().min(1).max(40), field: z.enum(["onScreenText", "narration", "title"]), value: z.string().max(2000) }),
  z.object({ op: z.literal("retime"), scene: z.number().int().min(1).max(40), durationS: z.number().min(0.8).max(60) }),
  z.object({ op: z.literal("setTotalDuration"), deliverable: z.number().int().min(1).max(8).default(1), durationS: z.number().min(3).max(600) }),
  z.object({ op: z.literal("reorderScenes"), order: z.array(z.number().int().min(1).max(40)).min(1).max(40) }),
  z.object({ op: z.literal("removeScene"), scene: z.number().int().min(1).max(40) }),
  z.object({ op: z.literal("addScene"), after: z.number().int().min(0).max(40), scene: SceneSchema }),
  z.object({ op: z.literal("setLayout"), scene: z.number().int().min(1).max(40), visualSource: SceneSchema.shape.visualSource, role: z.enum(SCENE_ROLES).optional() }),
  z.object({ op: z.literal("setCta"), text: z.string().max(60).optional(), url: z.string().max(120).optional() }),
  z.object({ op: z.literal("setStyle"), motion: z.enum(["calm", "standard", "energetic"]).optional(), textScale: z.number().min(0.7).max(1.6).optional(), captions: z.boolean().optional() }),
  z.object({ op: z.literal("setTone"), tone: z.string().max(200) }),
  z.object({ op: z.literal("addDeliverable"), name: z.string().max(120), aspect: z.enum(ASPECTS), durationS: z.number().min(1).max(600) }),
  z.object({ op: z.literal("removeDeliverable"), name: z.string().max(120) }),
  z.object({ op: z.literal("setVoiceover"), needed: z.boolean(), direction: z.string().max(600).optional() }),
]);
export type EditOp = z.infer<typeof EditOpSchema>;
export const EditOpsSchema = z.object({ ops: z.array(EditOpSchema).max(20), summary: z.string().max(400).default("") });
