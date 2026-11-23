import { body, route } from "@/server/http";
import { validateGraph } from "@/server/engine/validate";
export const dynamic = "force-dynamic";
export const POST = route(async (req) => validateGraph(await body(req)));
