import type { DirectorPlan } from "@/shared/schema";
import { DirectorPlanSchema } from "@/shared/schema";
import { getRecipe, WRITE_ME } from "./recipes";

/**
 * Creative QA: deterministic, explainable checks on the plan (before anything renders) and on the rendered
 * technical report. These are observable criteria — pacing, reading speed, hook length, end card, honesty —
 * not a claim that a video is "professional". A bounded auto-fix pass repairs what can be repaired without
 * changing meaning (timings, line breaks, missing CTA); everything else is reported to the user.
 */

export type Severity = "critical" | "major" | "minor";

export interface CreativeIssue {
  id: string;
  severity: Severity;
  /** Plain-language message for the user. */
  message: string;
  scene?: number;
  /** True when Orkestr can fix it automatically. */
  fixable: boolean;
}

export interface CreativeReport {
  issues: CreativeIssue[];
  passed: number;
  total: number;
  /** Plain-language fixes applied by the auto-improve pass. */
  fixes: string[];
}

const isArabic = (lang: string) => /arab/i.test(lang);
/** Characters per second a viewer can comfortably read on screen. */
const MAX_CPS = 17;
const HOOK_MAX_S = 2.5;

export function hexLuminance(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number | null {
  const la = hexLuminance(a);
  const lb = hexLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export interface QaContext {
  claims?: string[];
  palette?: Record<string, string>;
  /** Text read from the user's website: numbers found there are flagged for confirmation, not as invented. */
  siteText?: string;
}

const PLACEHOLDER_SOURCES = ["generated-image", "generated-video", "stock", "placeholder"];

export function reviewPlan(plan: DirectorPlan, ctx: QaContext = {}): CreativeReport {
  const issues: CreativeIssue[] = [];
  let total = 0;
  const check = (ok: boolean, issue: Omit<CreativeIssue, "id"> & { id: string }) => {
    total++;
    if (!ok) issues.push(issue);
  };
  const recipe = getRecipe(plan.recipe);
  const poster = recipe?.deliverables[0]?.kind === "poster" || plan.deliverables.every((d) => d.durationS <= 1);
  const loop = recipe?.id === "hero-loop";
  const main = plan.deliverables[0];
  const ar = isArabic(plan.language);
  const maxChars = ar ? 32 : 40;
  const sum = plan.scenes.reduce((a, s) => a + s.durationS, 0);

  // Missing copy the user must write.
  plan.scenes.forEach((s, i) => check(!s.onScreenText.startsWith(WRITE_ME), { id: `write-${i + 1}`, severity: "critical", scene: i + 1, message: `Scene ${i + 1} needs a line from you (${s.onScreenText.slice(WRITE_ME.length) || "on-screen text"}).`, fixable: false }));

  if (!poster) {
    check(Math.abs(sum - main.durationS) <= 0.5, { id: "length", severity: "critical", message: `Scenes add up to ${sum.toFixed(1)} s but the video should be ${main.durationS} s.`, fixable: true });
    const hook = plan.scenes[0];
    if (!loop) {
      check(hook.durationS <= HOOK_MAX_S, { id: "hook-length", severity: "major", scene: 1, message: `The opening lasts ${hook.durationS} s; hooks work best in the first ${HOOK_MAX_S} s.`, fixable: true });
      check(!!hook.onScreenText.trim() || !!hook.narration.trim(), { id: "hook-text", severity: "major", scene: 1, message: "The opening scene has no words: viewers decide in the first two seconds.", fixable: false });
    }
    plan.scenes.forEach((s, i) => {
      const ui = s.visualSource === "ui-capture";
      const last = i === plan.scenes.length - 1;
      const min = i === 0 ? 1.2 : 1.5;
      const max = ui ? 7 : last ? 5 : 6;
      if (i > 0) check(s.durationS >= min && s.durationS <= max, { id: `pace-${i + 1}`, severity: "major", scene: i + 1, message: `Scene ${i + 1} lasts ${s.durationS} s (aim for ${min}–${max} s) — ${s.durationS < min ? "too fast to read" : "it will drag"}.`, fixable: true });
      const text = s.onScreenText.replace(/\n/g, " ").trim();
      if (text && !text.startsWith(WRITE_ME)) {
        const cps = text.length / Math.max(0.5, s.durationS - 0.4);
        check(cps <= MAX_CPS, { id: `read-${i + 1}`, severity: "major", scene: i + 1, message: `Scene ${i + 1}: ${text.length} characters in ${s.durationS} s is hard to read (${cps.toFixed(0)} characters per second).`, fixable: true });
        const longest = Math.max(...s.onScreenText.split("\n").map((l) => l.trim().length));
        check(longest <= maxChars || s.onScreenText.split("\n").length > 1, { id: `line-${i + 1}`, severity: "minor", scene: i + 1, message: `Scene ${i + 1}: the line is long for one row; it will be broken into two.`, fixable: true });
      }
      if (s.narration.trim()) {
        const words = s.narration.trim().split(/\s+/).length;
        const wps = words / Math.max(0.5, s.durationS);
        check(wps <= (ar ? 2.4 : 2.8), { id: `vo-${i + 1}`, severity: "major", scene: i + 1, message: `Scene ${i + 1}: ${words} words of narration in ${s.durationS} s will sound rushed.`, fixable: true });
      }
    });
    // Variety: never the same visual source three times in a row.
    // (Type-led recipes are motion graphics by design; variety there comes from the type, not the source.)
    const typeLed = !!recipe && recipe.beats.every((b) => b.source === "motion-graphics");
    for (let i = 2; i < plan.scenes.length - 1 && !typeLed; i++) {
      const [a, b2, c] = [plan.scenes[i - 2], plan.scenes[i - 1], plan.scenes[i]].map((s) => s.visualSource);
      if (a === b2 && b2 === c && a !== "ui-capture") check(false, { id: `variety-${i + 1}`, severity: "minor", scene: i + 1, message: `Scenes ${i - 1}–${i + 1} look alike; vary the visuals for rhythm.`, fixable: false });
      else total++;
    }
    if (!loop) {
      const end = plan.scenes[plan.scenes.length - 1];
      check(end.durationS >= 2.5, { id: "end-card", severity: "major", scene: plan.scenes.length, message: "The end card is too short to read the call to action.", fixable: true });
      check(!!plan.cta.text.trim(), { id: "cta", severity: "major", message: "There is no call to action.", fixable: true });
    }
  }
  plan.scenes.forEach((s, i) => check(!PLACEHOLDER_SOURCES.includes(s.visualSource), { id: `placeholder-${i + 1}`, severity: "critical", scene: i + 1, message: `Scene ${i + 1} asks for ${s.visualSource.replace("-", " ")}, which no tool on this machine can make — it would be a marked placeholder.`, fixable: true }));

  // Honesty: numbers/percentages on screen must come from confirmed facts.
  const claims = (ctx.claims ?? []).join(" ");
  plan.scenes.forEach((s, i) => {
    const nums = (s.onScreenText.match(/\d[\d.,]*%?|[٠-٩]+%?/g) ?? []).map((n) => n.replace(/[.,]$/, ""));
    const unconfirmed = nums.filter((n) => !claims.includes(n));
    const fromSite = unconfirmed.length > 0 && unconfirmed.every((n) => (ctx.siteText ?? "").includes(n));
    if (nums.length)
      check(unconfirmed.length === 0, {
        id: `fact-${i + 1}`,
        severity: fromSite ? "minor" : "major",
        scene: i + 1,
        message: fromSite ? `Scene ${i + 1} quotes "${unconfirmed.join(", ")}" from your website — you'll confirm it before producing.` : `Scene ${i + 1} states "${unconfirmed.join(", ")}", which is not in your confirmed facts.`,
        fixable: false,
      });
  });

  if (ctx.palette?.fg && ctx.palette?.bg) {
    const r = contrastRatio(ctx.palette.fg, ctx.palette.bg);
    if (r !== null) check(r >= 4.5, { id: "contrast", severity: "major", message: `Brand text colour on background has a contrast of ${r.toFixed(1)}:1 (needs 4.5:1 to be readable).`, fixable: false });
  }
  const order: Record<Severity, number> = { critical: 0, major: 1, minor: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return { issues, passed: total - issues.length, total, fixes: [] };
}

/** Break a long single line into two balanced lines at a word boundary. */
export function balanceLine(text: string, max: number): string {
  if (text.includes("\n") || text.length <= max) return text;
  const words = text.split(" ");
  if (words.length < 2) return text;
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const d = Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length);
    if (d < bestDiff) (bestDiff = d), (best = i);
  }
  return `${words.slice(0, best).join(" ")}\n${words.slice(best).join(" ")}`;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * One deterministic repair pass. Only changes timing, line breaks, CTA defaults and unproducible sources —
 * never the meaning of the copy.
 */
function repair(plan: DirectorPlan, issues: CreativeIssue[]): { plan: DirectorPlan; fixes: string[] } {
  const p: DirectorPlan = structuredClone(plan);
  const fixes: string[] = [];
  const ids = new Set(issues.filter((i) => i.fixable).map((i) => i.id));
  const ar = isArabic(p.language);
  const n = p.scenes.length;
  const main = p.deliverables[0];
  if (ids.has("hook-length") && n > 1) {
    const extra = r1(p.scenes[0].durationS - 2);
    p.scenes[0].durationS = 2;
    p.scenes[1].durationS = r1(p.scenes[1].durationS + extra);
    fixes.push("Tightened the opening to 2 s so the hook lands immediately.");
  }
  for (const s of p.scenes.map((_, i) => i)) {
    if (ids.has(`line-${s + 1}`)) {
      p.scenes[s].onScreenText = balanceLine(p.scenes[s].onScreenText, ar ? 32 : 40);
      fixes.push(`Balanced the text of scene ${s + 1} over two lines.`);
    }
    if (ids.has(`placeholder-${s + 1}`)) {
      p.scenes[s].visualSource = "motion-graphics";
      fixes.push(`Scene ${s + 1} now uses motion graphics instead of an unavailable generator.`);
    }
  }
  if (ids.has("end-card") && n > 1) {
    const need = r1(3 - p.scenes[n - 1].durationS);
    p.scenes[n - 1].durationS = 3;
    const donor = p.scenes.slice(1, -1).reduce((best, s, i) => (s.durationS > p.scenes[best + 1].durationS ? i : best), 0) + 1;
    p.scenes[donor].durationS = r1(Math.max(1.5, p.scenes[donor].durationS - need));
    fixes.push("Held the end card for 3 s so the call to action can be read.");
  }
  if (ids.has("cta")) {
    p.cta.text = ar ? "جرّبه دلوقتي" : "Learn more";
    fixes.push(`Added a call to action ("${p.cta.text}") — change it if you prefer another.`);
  }
  // Reading speed / pace: give slow-to-read scenes time from scenes with slack, keeping the total.
  const tooFast = p.scenes.map((s, i) => ({ s, i })).filter(({ i }) => ids.has(`read-${i + 1}`) || ids.has(`vo-${i + 1}`) || (ids.has(`pace-${i + 1}`) && p.scenes[i].durationS < 1.5));
  for (const { s, i } of tooFast) {
    const textNeed = (s.onScreenText.replace(/\n/g, " ").trim().length / MAX_CPS) + 0.4;
    const voNeed = s.narration.trim() ? s.narration.trim().split(/\s+/).length / (ar ? 2.3 : 2.6) : 0;
    const need = r1(Math.min(6.5, Math.max(1.5, textNeed, voNeed)) - s.durationS);
    if (need <= 0) continue;
    let left = need;
    for (let j = 1; j < n - 1 && left > 0; j++) {
      if (j === i) continue;
      const sc = p.scenes[j];
      const minJ = Math.max(1.5, sc.onScreenText.trim().length / MAX_CPS + 0.4);
      const give = r1(Math.max(0, Math.min(left, sc.durationS - minJ)));
      if (give > 0) {
        sc.durationS = r1(sc.durationS - give);
        left = r1(left - give);
      }
    }
    const got = r1(need - left);
    if (got > 0) {
      p.scenes[i].durationS = r1(p.scenes[i].durationS + got);
      fixes.push(`Gave scene ${i + 1} ${got} s more so it can be read.`);
    }
  }
  for (const { i } of p.scenes.map((s, i) => ({ s, i })).filter(({ i }) => ids.has(`pace-${i + 1}`) && p.scenes[i].durationS > 6)) {
    const over = r1(p.scenes[i].durationS - (p.scenes[i].visualSource === "ui-capture" ? 7 : 6));
    if (over > 0 && n > 2) {
      p.scenes[i].durationS = r1(p.scenes[i].durationS - over);
      const target = p.scenes.reduce((best, s, j) => (j > 0 && j !== i && s.durationS < p.scenes[best].durationS ? j : best), i === 1 ? 2 : 1);
      p.scenes[target].durationS = r1(p.scenes[target].durationS + over);
      fixes.push(`Shortened scene ${i + 1} so it does not drag.`);
    }
  }
  // Exact length last.
  if (main.durationS > 1) {
    const sum = p.scenes.reduce((a, s) => a + s.durationS, 0);
    const diff = r1(main.durationS - sum);
    if (Math.abs(diff) > 0.05) {
      const k = Math.abs(diff) > 0.5 ? main.durationS / sum : 1;
      if (k !== 1) {
        p.scenes.forEach((s) => (s.durationS = r1(Math.max(1, s.durationS * k))));
        fixes.push(`Re-timed the scenes to fit ${main.durationS} s.`);
      }
      const sum2 = p.scenes.reduce((a, s) => a + s.durationS, 0);
      p.scenes[n - 1].durationS = r1(p.scenes[n - 1].durationS + main.durationS - sum2);
    }
  }
  return { plan: DirectorPlanSchema.parse(p), fixes };
}

/** Bounded improvement loop: review → repair → re-review, at most `maxPasses` times. Never loops forever. */
export function improvePlan(plan: DirectorPlan, ctx: QaContext = {}, maxPasses = 2): { plan: DirectorPlan; report: CreativeReport } {
  let cur = plan;
  const fixes: string[] = [];
  let report = reviewPlan(cur, ctx);
  for (let pass = 0; pass < maxPasses && report.issues.some((i) => i.fixable); pass++) {
    const r = repair(cur, report.issues);
    if (!r.fixes.length) break;
    fixes.push(...r.fixes);
    cur = r.plan;
    report = reviewPlan(cur, ctx);
  }
  return { plan: cur, report: { ...report, fixes: [...new Set(fixes)] } };
}

/** Map a technical QA report (production.qa) to plain-language issues. */
export function technicalIssues(report: { pass: boolean; checks: { name: string; pass: boolean; severity: string; expected?: unknown; actual?: unknown; message?: string }[] } | null | undefined, deliverable: string): CreativeIssue[] {
  if (!report) return [];
  return report.checks
    .filter((c) => !c.pass)
    .map((c, i) => ({
      id: `tech-${deliverable}-${i}`,
      severity: (c.severity === "critical" ? "critical" : c.severity === "major" ? "major" : "minor") as Severity,
      message: `${deliverable}: ${c.message ?? `${c.name} is ${String(c.actual)} (expected ${String(c.expected)})`}`,
      fixable: false,
    }));
}
