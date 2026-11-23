import { route } from "@/server/http";
import { listTemplates } from "@/server/templates";
export const dynamic = "force-dynamic";
export const GET = route(() => listTemplates().map(({ graph: _g, ...t }) => t));
