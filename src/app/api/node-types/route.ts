import { route } from "@/server/http";
import { nodeTypeInfos } from "@/server/engine/node-types";
export const dynamic = "force-dynamic";
export const GET = route(() => nodeTypeInfos());
