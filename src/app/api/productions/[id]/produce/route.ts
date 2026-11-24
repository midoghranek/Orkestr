import { z } from "zod";
import { body, route } from "@/server/http";
import { produce } from "@/server/producer";
export const dynamic = "force-dynamic";
const Input = z.object({
  confirmFacts: z.boolean(),
  confirmWebsiteRights: z.boolean().optional(),
  voice: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("none") }),
      z.object({ kind: z.literal("asset"), assetId: z.string().max(64) }),
      z.object({ kind: z.literal("elevenlabs"), voiceId: z.string().min(1).max(60) }),
    ])
    .optional(),
  budgetUsd: z.number().min(0).max(10000).optional(),
});
export const POST = route<{ id: string }>(async (req, { id }) => produce(id, Input.parse(await body(req))));
