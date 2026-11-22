/**
 * Orkestr worker: the only process that executes jobs. The web server only writes intents
 * (runs, approvals, cancellations) to SQLite; this loop picks them up. State lives in the DB,
 * so a crash or restart resumes where it left off.
 */
import { getDb } from "../src/server/db";
import { runDiscovery } from "../src/server/adapters/registry";
import { Engine } from "../src/server/engine/engine";
import { processPlans, requeueStalePlans } from "../src/server/director";
import { emit } from "../src/server/events";

async function main() {
  getDb();
  console.log("[worker] discovering tools…");
  const reg = await runDiscovery();
  for (const t of reg.tools) console.log(`[worker]  ${t.health.status.padEnd(12)} ${t.id.padEnd(12)} ${t.health.message}`);
  requeueStalePlans();
  const engine = new Engine();
  engine.start();
  emit({ type: "worker.started", message: `worker ${engine.workerId} started` });
  console.log(`[worker] ${engine.workerId} ready (concurrency ${engine.concurrency})`);

  const planTimer = setInterval(() => void processPlans(), 1000);
  // Re-run discovery every 10 minutes so health reflects installs/credentials added while running.
  const discTimer = setInterval(() => void runDiscovery().catch(() => undefined), 10 * 60_000);
  // Allow the UI to request a refresh.
  const refreshTimer = setInterval(() => {
    const r = getDb().prepare("SELECT value_json FROM settings WHERE key = '__discovery_requested'").get() as { value_json: string } | undefined;
    if (r && r.value_json === "true") {
      getDb().prepare("DELETE FROM settings WHERE key = '__discovery_requested'").run();
      void runDiscovery().then(() => emit({ type: "discovery.completed", message: "tool discovery refreshed" }));
    }
  }, 1000);

  let stopping = false;
  const shutdown = async (sig: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`[worker] ${sig}: stopping (running jobs are cancelled and will be retried on next start)`);
    clearInterval(planTimer);
    clearInterval(discTimer);
    clearInterval(refreshTimer);
    await engine.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("[worker] fatal", e);
  process.exit(1);
});
