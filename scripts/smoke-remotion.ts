/** Smoke test: render the TestCard composition through the real adapter and probe the result (free). */
import fs from "node:fs";
import path from "node:path";
import { RemotionAdapter } from "../src/server/adapters/remotion";
import { FfmpegAdapter } from "../src/server/adapters/ffmpeg";
import { workDir } from "../src/server/util/paths";

const dir = path.join(workDir(), "smoke-remotion");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const ctx = { signal: new AbortController().signal, workDir: dir, projectId: "smoke", runId: "smoke", nodeRunId: "smoke", progress: () => undefined, log: (l: string, m: string) => console.log(`[${l}] ${m}`) };
const ff = new FfmpegAdapter();
await ff.discover();
const t = Date.now();
const r = await new RemotionAdapter().execute("render", { composition: "TestCard", props: { label: "Orkestr smoke", durationS: 2 } }, ctx);
for (const a of r.artifacts) console.log(a.port.padEnd(12), a.kind.padEnd(6), path.basename(a.file));
const video = r.artifacts.find((a) => a.kind === "video")!;
const p = await ff.probe(video.file);
console.log(`${Date.now() - t}ms`, JSON.stringify(p.streams.map((s) => [s.codec_type, s.codec_name, s.width, s.height, s.pix_fmt, s.avg_frame_rate])), p.format.duration);
