/** `npm run discover`: probe every tool, print the capability matrix, persist data/capabilities.json. No credits are spent. */
import { runDiscovery } from "../src/server/adapters/registry";

const reg = await runDiscovery();
console.log("Environment:", JSON.stringify(reg.environment));
for (const t of reg.tools) {
  console.log(`\n${t.health.status.toUpperCase().padEnd(12)} ${t.name} ${t.discovery.version ?? ""}\n  ${t.health.message}`);
  for (const c of t.capabilities) console.log(`  ${c.ready ? "✔" : "✘"} ${c.id.padEnd(26)} ${c.paid ? "[paid] " : ""}${c.ready ? "" : `— ${c.blockedReason ?? ""}`}`);
}
console.log("\nChecked but not available:");
for (const u of reg.unavailable) console.log(`  ✘ ${u.name}: ${u.reason}`);
