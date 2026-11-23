/**
 * `npm run seed:demo` — creates the **acme-cafe** demo project with dummy data only.
 *
 * Everything here is fictional: "Acme Café" is a placeholder brand, the claims are invented sample facts, and the
 * media (logos, stills, a test clip, a test tone) are generated locally with FFmpeg into data/demo-brand. Nothing
 * is downloaded and nothing is spent. The plan is a hand-written fixture (NOT produced by the AI Director) that is
 * accepted through the normal code path, so the storyboard and the workflow graph are built exactly as in real use.
 *
 * Idempotent: re-running reuses the project, skips already-imported files (same sha256) and only adds the demo
 * plan/storyboard/workflow when the project has none.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { getDb } from "../src/server/db";
import { createProject, getProject, listWorkflows, updateProject } from "../src/server/projects";
import { importFile, listAssets } from "../src/server/assets";
import { getSettings, updateSettings } from "../src/server/settings";
import { acceptPlan } from "../src/server/director";
import { DirectorPlanSchema, type DirectorPlan } from "../src/shared/schema";
import { newId, sha256File } from "../src/server/util/ids";
import { dataDir } from "../src/server/util/paths";

const SLUG = "acme-cafe";
const BRAND = path.join(dataDir(), "demo-brand");

// Fictional sample facts. The AI Director may only use claims listed on the project — these are dummy values.
const CLAIMS = [
  "Demo claim: Acme Café is a fictional coffee shop used to demonstrate Orkestr",
  "Demo claim: orders can be placed at the counter or from a phone",
  "Demo claim: the menu has espresso drinks, filter coffee and pastries",
  "Demo claim: open every day from 8:00 to 20:00",
  "Do NOT state prices, customer numbers or awards — none exist",
];

const PALETTE = { bg: "#F4EFE4", fg: "#17140F", accent: "#FFD23F", accent2: "#8C6CFF", surface: "#17140F", onSurface: "#F4EFE4" };

/** Dummy media generated with FFmpeg (lavfi sources + drawtext). */
const FILES: { name: string; label: string; note: string; args: string[] }[] = [
  {
    name: "logo-light.png",
    label: "Logo · horizontal (light bg)",
    note: "dummy logo generated for the demo",
    args: ["-f", "lavfi", "-i", "color=c=0xF4EFE4:s=1200x400", "-frames:v", "1", "-vf", txt("ACME CAFÉ", 150, "0x17140F")],
  },
  {
    name: "logo-dark.png",
    label: "Logo · horizontal (dark bg)",
    note: "dummy logo generated for the demo",
    args: ["-f", "lavfi", "-i", "color=c=0x17140F:s=1200x400", "-frames:v", "1", "-vf", txt("ACME CAFÉ", 150, "0xFFD23F")],
  },
  ...(
    [
      ["counter", "0xFFD23F", "The counter"],
      ["espresso", "0x8C6CFF", "Espresso bar"],
      ["pastries", "0xFF6B4A", "Pastry shelf"],
      ["terrace", "0x3DDC97", "Terrace"],
    ] as const
  ).map(([n, c, t]) => ({
    name: `photo-${n}.png`,
    label: `Brand photo · ${n}`,
    note: "dummy flat-colour still standing in for brand photography — replace with real footage",
    args: ["-f", "lavfi", "-i", `color=c=${c}:s=1920x1080`, "-frames:v", "1", "-vf", txt(t, 120, "0x17140F")],
  })),
  {
    name: "test-clip.mp4",
    label: "B-roll · test pattern (4 s)",
    note: "FFmpeg test pattern standing in for video footage",
    args: ["-f", "lavfi", "-i", "testsrc2=s=1920x1080:d=4:r=25", "-c:v", "libx264", "-pix_fmt", "yuv420p"],
  },
  {
    name: "test-tone.wav",
    label: "Music bed · test tone (8 s)",
    note: "sine test tone standing in for licensed music",
    args: ["-f", "lavfi", "-i", "sine=f=330:d=8", "-af", "volume=0.2"],
  },
];

function txt(text: string, size: number, color: string) {
  return `drawtext=text='${text}':fontsize=${size}:fontcolor=${color}:x=(w-tw)/2:y=(h-th)/2`;
}

/** Hand-written demo plan (fixture). Validated by the same schema as AI Director output. */
const PLAN: DirectorPlan = DirectorPlanSchema.parse({
  title: "Acme Café — Morning ritual (demo)",
  logline: "A 20-second demo spot: the counter opens, coffee is pulled, pastries come out, the terrace fills.",
  language: "English",
  audience: "People evaluating Orkestr with dummy data",
  tone: "Warm, brisk, confident",
  deliverables: [
    { name: "Spot", aspect: "16:9", durationS: 20 },
    { name: "Social cut", aspect: "9:16", durationS: 10 },
  ],
  script: "Eight o'clock. The counter opens.\nEspresso, pulled the same way every time.\nPastries out of the oven.\nAcme Café — your morning, sorted.",
  scenes: [
    { title: "The counter opens", durationS: 5, narration: "Eight o'clock. The counter opens.", onScreenText: "Open at 8", visualSource: "brand-asset", tool: "ffmpeg" },
    { title: "Espresso bar", durationS: 5, narration: "Espresso, pulled the same way every time.", onScreenText: "Every cup, the same", visualSource: "brand-asset", tool: "ffmpeg" },
    { title: "Pastry shelf", durationS: 5, narration: "Pastries out of the oven.", onScreenText: "Fresh every morning", visualSource: "brand-asset", tool: "ffmpeg" },
    { title: "صباحك على مزاجك", durationS: 5, narration: "Acme Café — your morning, sorted.", onScreenText: "Acme Café", visualSource: "motion-graphics", tool: "remotion" },
  ],
  voiceover: { needed: false, language: "", direction: "" },
  music: "Test tone from the asset library (placeholder for licensed music)",
  questions: ["Should the social cut keep the Arabic end card?"],
  risks: ["All visuals are dummy stills; final renders carry the DRAFT placeholder banner."],
});

function ffmpeg(args: string[], out: string) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...args, out], { stdio: "inherit" });
}

async function main() {
  getDb();
  fs.mkdirSync(BRAND, { recursive: true });
  for (const f of FILES) {
    const out = path.join(BRAND, f.name);
    if (!fs.existsSync(out)) ffmpeg(f.args, out);
  }
  const roots = new Set(getSettings().importRoots);
  roots.add(BRAND);
  updateSettings({ importRoots: [...roots] });

  const settings = {
    productUrl: "https://example.com",
    brandName: "Acme Café",
    language: "English",
    palette: PALETTE,
    verifiedClaims: CLAIMS,
    brandNotes: "Fictional demo brand. Tone: warm and brisk. Never claim prices, customer counts or awards.",
  };
  const description = "Demo project with dummy data — a fictional café, generated stills and test media.";
  const brief =
    "Make a 20-second 16:9 spot and a 10-second 9:16 social cut for Acme Café (a fictional demo brand).\nStory: the counter opens → espresso → pastries → end card.\nUse only the demo stills and the listed demo claims.";
  let p = getProject(SLUG);
  if (!p) p = createProject({ name: "Acme Café (demo)", slug: SLUG, description, brief, budgetUsd: 0, settings });
  else p = updateProject(p.id, { description, brief, settings });

  const existing = new Set(listAssets(p.id, { limit: 1000 }).map((a) => a.sha256));
  const byLabel = new Map<string, string>();
  for (const f of FILES) {
    const abs = path.join(BRAND, f.name);
    if (existing.has(await sha256File(abs))) continue;
    const a = await importFile(abs, [BRAND], { projectId: p.id, label: f.label, metadata: { note: f.note, demo: true, placeholder: true } });
    console.log(`imported ${a.id}  ${f.label}`);
  }
  for (const a of listAssets(p.id, { limit: 1000 })) byLabel.set(a.label, a.id);

  if (listWorkflows(p.id).length === 0) {
    const planId = newId("pln");
    const now = Date.now();
    getDb()
      .prepare("INSERT INTO plans (id, project_id, brief, status, plan_json, model, cost_usd, created_at, finished_at) VALUES (?, ?, ?, 'completed', ?, ?, 0, ?, ?)")
      .run(planId, p.id, brief, JSON.stringify(PLAN), "demo fixture (hand-written, not AI-generated)", now, now);
    const pool = ["counter", "espresso", "pastries", "terrace"].map((n) => byLabel.get(`Brand photo · ${n}`)).filter((x): x is string => !!x);
    const r = acceptPlan(planId, {
      imagePool: pool,
      logoAssetId: byLabel.get("Logo · horizontal (light bg)"),
      logoReversedAssetId: byLabel.get("Logo · horizontal (dark bg)"),
      musicAssetId: byLabel.get("Music bed · test tone (8 s)"),
      voiceover: { kind: "none" },
      palette: PALETTE,
      direction: "ltr",
    });
    console.log(`demo plan accepted → workflow ${r.workflowId}${r.issues.length ? ` (${r.issues.length} validation notes)` : ""}`);
  }
  console.log(`\nacme-cafe demo project: http://127.0.0.1:4317/projects/${p.slug}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
