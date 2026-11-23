import { z } from "zod";
import { body, route } from "@/server/http";
import { acceptPlan } from "@/server/director";
export const dynamic = "force-dynamic";
const Opts = z.object({
  imagePool: z.array(z.string().max(64)).max(60).default([]),
  logoAssetId: z.string().max(64).optional(),
  logoReversedAssetId: z.string().max(64).optional(),
  musicAssetId: z.string().max(64).optional(),
  voiceover: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("asset"), assetId: z.string().max(64) }),
      z.object({ kind: z.literal("elevenlabs"), voiceId: z.string().max(60), modelId: z.string().max(60).optional(), languageCode: z.string().max(5).optional() }),
      z.object({ kind: z.literal("none") }),
    ])
    .default({ kind: "none" }),
  whisperLanguage: z.string().max(5).optional(),
  palette: z.record(z.string(), z.string()).optional(),
  direction: z.enum(["rtl", "ltr"]).optional(),
});
export const POST = route<{ id: string }>(async (req, { id }) => acceptPlan(id, Opts.parse(await body(req))));
