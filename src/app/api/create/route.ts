import { z } from "zod";
import { body, route } from "@/server/http";
import { startCreation } from "@/server/producer";
export const dynamic = "force-dynamic";
const Input = z.object({
  prompt: z.string().min(3).max(4000),
  url: z.string().max(400).optional(),
  recipeId: z.string().max(40).optional(),
  projectId: z.string().max(64).optional(),
  planner: z.enum(["ai", "recipe", "auto"]).default("auto"),
  assetIds: z.array(z.string().max(64)).max(40).default([]),
});
/** "What do you want to create today?" — one request starts a whole production. */
export const POST = route(async (req) => {
  const r = startCreation(Input.parse(await body(req)));
  return { productionId: r.productionId, projectId: r.project.id, slug: r.project.slug, recipe: r.intent.recipeId, planner: r.intent.planner, reason: r.intent.reason };
});
