import { z } from "zod";
import { body, route } from "@/server/http";
import { retryFailed } from "@/server/engine/engine";
export const dynamic = "force-dynamic";
export const POST = route<{ id: string }>(async (req, { id }) => {
  const { nodeIds } = z.object({ nodeIds: z.array(z.string().max(64)).max(500).optional() }).parse(await body(req));
  retryFailed(id, nodeIds);
  return { retrying: true };
});
