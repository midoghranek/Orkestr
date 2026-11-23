import { z } from "zod";
import { body, route } from "@/server/http";
import { createRun } from "@/server/engine/engine";
export const dynamic = "force-dynamic";
export const POST = route<{ id: string }>(async (req, { id }) => {
  const b = z.object({ preauthorizedUsd: z.number().min(0).max(10000).default(0), forceNodes: z.array(z.string().max(64)).max(500).default([]) }).parse(await body(req));
  return { runId: createRun(id, b) };
});
