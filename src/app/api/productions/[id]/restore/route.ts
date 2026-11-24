import { z } from "zod";
import { body, route } from "@/server/http";
import { restoreVersion } from "@/server/producer";
export const dynamic = "force-dynamic";
export const POST = route<{ id: string }>(async (req, { id }) => restoreVersion(id, z.object({ planId: z.string().max(64) }).parse(await body(req)).planId));
