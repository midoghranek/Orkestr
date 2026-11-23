/**
 * `npm run seed:kafeeh` — creates the kafeeh acceptance project from the real brand system in the sibling
 * CafeOS repo (logos, graded photography) and the claims published on the live landing page.
 * Idempotent: re-running reuses the project and skips already imported files (same sha256).
 */
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/server/db";
import { createProject, getProject, updateProject } from "../src/server/projects";
import { importFile, listAssets } from "../src/server/assets";
import { getSettings, updateSettings } from "../src/server/settings";
import { sha256File } from "../src/server/util/ids";

const CAFEOS = process.env.KAFEEH_REPO ?? path.resolve(process.cwd(), "..", "CafeOS");
const BRAND = path.join(CAFEOS, "apps", "design", "brand");

// Every claim below is quoted or condensed from CafeOS/apps/web/src/pages/landing/content.ts (the live landing copy).
const CLAIMS = [
  "Arabic-first café POS and management web app for Egypt (كاشير وتشغيل للكافيهات)",
  "14-day free trial, no payment details, no automatic charge (14 يوم تجربة، من غير بيانات دفع)",
  "Runs on an ordinary Android phone or tablet, or a computer browser — no dedicated cashier device (من غير جهاز كاشير مخصوص)",
  "3 steps from sign-up to the first order",
  "Order taking with sizes, add-ons and preparation notes; takeaway or tables",
  "A separate prep ticket for the bar, apart from the customer receipt",
  "Cash with change, or card via the bank terminal (the result is recorded after confirmation)",
  "Split payment between cash and card; partial payments for dine-in",
  "Several independent orders per table; collect one or all with a clear total",
  "Pressing «تحصيل» twice never records the payment twice",
  "Offline: after device setup, the main cashier keeps taking orders and cash without internet; operations sync when the connection returns",
  "Offline does NOT cover card payments, opening a new shift, refunds, switching staff or editing the menu",
  "Shift close: expected cash in the drawer vs counted, and the difference is recorded",
  "Reports by shift or date; collections and refunds by payment method",
  "Roles: owner, cashier, waiter; refunds need owner permission; PIN login and screen lock between staff",
  "Audit log of sensitive operations: who did what and when",
  "Prices are recorded at sale time: editing the menu later doesn't change old orders",
  "Each café's data is isolated",
  "Pricing: monthly per branch, price still being decided — do NOT state a price",
];

const PALETTE = { bg: "#F7F1E8", fg: "#22412D", accent: "#C97A55", accent2: "#4F7D5A", surface: "#1A3324", onSurface: "#F7F1E8" };

const FILES: { rel: string; label: string; note: string; placeholder?: boolean }[] = [
  { rel: "kafeeh/logos/png/kafeeh-horizontal-ar@4x.png", label: "Logo · horizontal AR (light bg)", note: "official logo, generated from vector masters" },
  { rel: "kafeeh/logos/png/kafeeh-horizontal-ar-reversed@4x.png", label: "Logo · horizontal AR (dark bg)", note: "official logo, reversed" },
  { rel: "kafeeh/logos/png/kafeeh-signature-ar-reversed@4x.png", label: "Logo · signature AR (dark bg)", note: "official marketing signature lockup" },
  { rel: "kafeeh/logos/png/kafeeh-mark-reversed@4x.png", label: "Logo · mark (dark bg)", note: "official symbol" },
  { rel: "kafeeh/social/kafeeh-og.png", label: "Social card (OG)", note: "official Open Graph card" },
  ...["hero-pos-cafe", "pos-in-cafe", "barista-latte-art", "cafe-interior", "cafe-owner", "coffee-croissant", "coffee-beans", "cafe-textures", "brand-lifestyle"].map((n) => ({
    rel: `photography/${n}.webp`,
    label: `Brand photo · ${n}`,
    note: "brand-graded crop from GENERATED concept boards (per brand README) — stand-in, replace with real Egyptian café footage before a paid campaign",
    placeholder: true,
  })),
];

async function main() {
  if (!fs.existsSync(BRAND)) throw new Error(`kafeeh brand folder not found at ${BRAND} (set KAFEEH_REPO)`);
  getDb();
  const roots = new Set(getSettings().importRoots);
  roots.add(BRAND);
  updateSettings({ importRoots: [...roots] });

  let p = getProject("kafeeh");
  const settings = {
    productUrl: "https://cafeos-app.vercel.app",
    brandName: "Kafeeh",
    brandPronunciation: "كافيه",
    language: "Egyptian Arabic",
    palette: PALETTE,
    verifiedClaims: CLAIMS,
    brandNotes:
      "Campaign line: «كافيهك تحت سيطرتك». In Arabic running text write the brand in Latin (Kafeeh); in narration pronounce it «كافيه». Typeface IBM Plex Sans Arabic. Colours: forest #1A3324/#22412D, cream #F7F1E8, terracotta accent #C97A55. Tone: warm, clear, in control. Never claim a price, customer count or integration that is not listed.",
  };
  const description = "Launch commercial for Kafeeh, the Arabic-first Egyptian café POS — «كافيهك تحت سيطرتك».";
  const brief =
    "اعمل إعلان لـ Kafeeh (بيتنطق «كافيه») — نظام كاشير وتشغيل للكافيهات في مصر. الفكرة: «كافيهك تحت سيطرتك».\n\nDeliverables: a 30–35 s 16:9 commercial, a 15 s 9:16 social cut, a 16:9 desktop homepage loop and a 9:16 mobile homepage loop, plus posters.\nAudience: Egyptian café owners and managers. Language: Egyptian Arabic narration and on-screen text.\nStory: the busy rush (orders, tables, cash) → Kafeeh on a normal tablet/phone keeps it in order → internet cuts and the cashier keeps selling cash → end of shift, expected vs counted is clear → 14-day free trial, no payment details.\nUse real Kafeeh UI captured from the live site, the official logo and the brand photography. Only use the verified claims.";
  if (!p) p = createProject({ name: "kafeeh", slug: "kafeeh", description, brief, budgetUsd: 25, settings });
  else p = updateProject(p.id, { description, brief, budgetUsd: p.budgetUsd || 25, settings });

  // Backfill the placeholder flag on photos imported by earlier versions of this script.
  getDb().prepare("UPDATE assets SET metadata_json = json_set(metadata_json, '$.placeholder', json('true')) WHERE project_id = ? AND label LIKE 'Brand photo%'").run(p.id);
  const existing = new Set(listAssets(p.id, { limit: 1000 }).map((a) => a.sha256));
  for (const f of FILES) {
    const abs = path.join(BRAND, f.rel);
    if (!fs.existsSync(abs)) {
      console.warn(`skip (missing): ${abs}`);
      continue;
    }
    if (existing.has(await sha256File(abs))) continue;
    const a = await importFile(abs, [BRAND], { projectId: p.id, label: f.label, metadata: { note: f.note, brandSource: f.rel, placeholder: !!f.placeholder } });
    console.log(`imported ${a.id}  ${f.label}`);
  }
  console.log(`\nkafeeh project: http://127.0.0.1:4317/projects/${p.slug}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
