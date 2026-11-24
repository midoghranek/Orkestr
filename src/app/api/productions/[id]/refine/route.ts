import { z } from "zod";
import { body, route } from "@/server/http";
import { refine } from "@/server/producer";
import { EditOpSchema } from "@/shared/schema";
export const dynamic = "force-dynamic";
const Input = z.object({ instruction: z.string().min(2).max(1000).optional(), ops: z.array(EditOpSchema).max(20).optional(), allowAi: z.boolean().default(false) });
export const POST = route<{ id: string }>(async (req, { id }) => refine(id, Input.parse(await body(req))));
