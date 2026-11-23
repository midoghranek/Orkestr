import { z } from "zod";
import { body, route } from "@/server/http";
import { rerunNodes } from "@/server/engine/engine";
export const dynamic = "force-dynamic";
export const POST = route<{ id: string }>(async (req, { id }) => {
  const { nodeIds } = z.object({ nodeIds: z.array(z.string().max(64)).min(1).max(500) }).parse(await body(req));
  return { runId: rerunNodes(id, nodeIds) };
});
