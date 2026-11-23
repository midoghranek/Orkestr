import { z } from "zod";
import { body, route } from "@/server/http";
import { decideApproval } from "@/server/views";
export const dynamic = "force-dynamic";
export const POST = route<{ id: string }>(async (req, { id }) => {
  const b = z.object({ decision: z.enum(["approved", "rejected"]), note: z.string().max(1000).optional() }).parse(await body(req));
  return decideApproval(id, b.decision, b.note);
});
