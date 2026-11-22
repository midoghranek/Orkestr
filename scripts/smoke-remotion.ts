import fs from "node:fs";
import path from "node:path";
import { RemotionAdapter } from "../src/server/adapters/remotion";
import { FfmpegAdapter } from "../src/server/adapters/ffmpeg";
import { workDir } from "../src/server/util/paths";

const dir = path.join(workDir(), "smoke-remotion");
fs.mkdirSync(dir, { recursive: true });
const ctx = { signal: new AbortController().signal, workDir: dir, projectId: "smoke", runId: "smoke", nodeRunId: "smoke", progress: (f: number, m?: string) => process.stdout.write(`\r${Math.round(f * 100)}% ${m ?? ""}      `), log: (l: string, m: string) => console.log(`[${l}] ${m}`) };
const t = Date.now();
const r = await new RemotionAdapter().execute("render", { composition: "TestCard", props: { label: "Orkestr smoke", durationS: 2 } }, ctx);
console.log("\nrendered", r.artifacts[0].file, `${Date.now() - t}ms`);
const ff = new FfmpegAdapter();
await ff.discover();
const p = await ff.probe(r.artifacts[0].file);
console.log(JSON.stringify(p.streams.map((s) => [s.codec_type, s.codec_name, s.width, s.height, s.avg_frame_rate]), null, 0), p.format.duration);
