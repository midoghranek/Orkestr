import { route } from "@/server/http";
import { loadRegistry } from "@/server/adapters/registry";
import { getSettings } from "@/server/settings";
import { listCredentials } from "@/server/credentials";
import { workerStatus } from "@/server/views";
import { installedModels } from "@/server/adapters/whisper";
export const dynamic = "force-dynamic";
export const GET = route(async () => ({ registry: loadRegistry() ?? null, settings: getSettings(), credentials: listCredentials(), worker: workerStatus(), whisperModels: installedModels() }));
