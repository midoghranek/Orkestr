import { route } from "@/server/http";
import { getDb } from "@/server/db";
import { runDiscovery } from "@/server/adapters/registry";
import { workerStatus } from "@/server/views";
export const dynamic = "force-dynamic";
export const POST = route(async () => {
  // Prefer letting the worker refresh (it owns the process allowlist it executes with); run inline if it is down.
  if (workerStatus().alive) {
    getDb().prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('__discovery_requested', 'true', ?) ON CONFLICT(key) DO UPDATE SET value_json='true', updated_at=excluded.updated_at").run(Date.now());
    return { queued: true };
  }
  return { queued: false, registry: await runDiscovery() };
});
