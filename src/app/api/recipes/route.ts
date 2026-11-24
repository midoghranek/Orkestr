import { route } from "@/server/http";
import { RECIPES } from "@/server/recipes";
export const dynamic = "force-dynamic";
export const GET = route(() => RECIPES.map(({ id, label, pitch, examples, deliverables, voiceover, needs }) => ({ id, label, pitch, examples, deliverables, voiceover, needs })));
