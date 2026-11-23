import { z } from "zod";
import { body, route } from "@/server/http";
import { installWhisper } from "@/server/adapters/whisper";
import { emit } from "@/server/events";
export const dynamic = "force-dynamic";
export const POST = route(async (req) => {
  const { model } = z.object({ model: z.enum(["tiny", "base", "small", "medium"]).default("base") }).parse(await body(req));
  emit({ type: "tools.install", message: `installing whisper.cpp + ggml-${model} (free download)` });
  void installWhisper(model, (m) => emit({ type: "tools.install", message: m }))
    .then(() => emit({ type: "tools.install", message: `whisper model ${model} installed — run discovery to enable it` }))
    .catch((e: Error) => emit({ level: "error", type: "tools.install", message: `whisper install failed: ${e.message}` }));
  return { started: true };
});
