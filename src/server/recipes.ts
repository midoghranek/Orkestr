import type { Aspect, DirectorPlan, Scene, SceneRole } from "@/shared/schema";
import { DirectorPlanSchema } from "@/shared/schema";

/**
 * Smart creative recipes. A recipe is a story structure (beats), deliverables and fallbacks — not a fixed
 * template. It constrains the AI Director, drives the free deterministic planner, and feeds creative QA.
 * A small number of recipes that work with the tools this machine actually has (real UI captures, brand
 * photos, type-led motion graphics) beats a long list of "cinematic" templates that would need generators.
 */

export type VisualSource = Scene["visualSource"];

export interface Beat {
  role: SceneRole;
  /** Share of the main duration (the planner normalises shares to the target length). */
  s: number;
  source: VisualSource;
  /** Used when the source cannot be produced (no product URL, no photos). */
  fallback: VisualSource;
}

export interface RecipeDeliverable {
  name: string;
  aspect: Aspect;
  durationS: number;
  kind: "cut" | "loop" | "poster";
}

export interface Recipe {
  id: string;
  label: string;
  /** One sentence for the recipe picker. */
  pitch: string;
  /** Examples shown as starting prompts. */
  examples: string[];
  deliverables: RecipeDeliverable[];
  beats: Beat[];
  voiceover: "none" | "optional" | "recommended";
  needs: ("productUrl" | "photos")[];
  fallbackRecipe: string | null;
  motion: "calm" | "standard" | "energetic";
  /** Guidance given to the AI Director. */
  direction: string;
}

const b = (role: SceneRole, s: number, source: VisualSource, fallback: VisualSource = "motion-graphics"): Beat => ({ role, s, source, fallback });

export const RECIPES: Recipe[] = [
  {
    id: "product-demo",
    label: "Product commercial",
    pitch: "Your real product on screen: a hook, three moments of the actual UI, and a clear call to action.",
    examples: ["Create a professional commercial for my SaaS product", "Turn my website into a promotional video"],
    deliverables: [
      { name: "Main commercial", aspect: "16:9", durationS: 30, kind: "cut" },
      { name: "Vertical cut", aspect: "9:16", durationS: 30, kind: "cut" },
    ],
    beats: [b("hook", 2, "motion-graphics"), b("problem", 3.5, "motion-graphics"), b("ui", 5, "ui-capture"), b("ui", 5, "ui-capture"), b("ui", 5, "ui-capture"), b("benefit", 3.5, "brand-asset", "ui-capture"), b("statement", 3, "motion-graphics"), b("cta", 3.5, "motion-graphics")],
    voiceover: "optional",
    needs: ["productUrl"],
    fallbackRecipe: "type-promo",
    motion: "standard",
    direction: "Open on a sharp 2-second hook line, name the pain in one line, then show the real product UI in three moments, each with one benefit headline. Close on a single call to action.",
  },
  {
    id: "social-reel",
    label: "Social reel",
    pitch: "A fast vertical reel for Instagram or TikTok: hook in the first two seconds, three quick beats, CTA.",
    examples: ["Make a 15-second Instagram reel for my café", "Turn these product photos into a premium social media reel"],
    deliverables: [
      { name: "Reel", aspect: "9:16", durationS: 15, kind: "cut" },
      { name: "Square post", aspect: "1:1", durationS: 15, kind: "cut" },
    ],
    beats: [b("hook", 1.8, "motion-graphics"), b("benefit", 2.6, "brand-asset", "ui-capture"), b("benefit", 2.6, "ui-capture", "brand-asset"), b("benefit", 2.6, "brand-asset", "motion-graphics"), b("statement", 2.4, "motion-graphics"), b("cta", 3, "motion-graphics")],
    voiceover: "none",
    needs: [],
    fallbackRecipe: "type-promo",
    motion: "energetic",
    direction: "Thumb-stopping first 2 seconds. Short lines (max 6 words). One idea per beat. End on one action.",
  },
  {
    id: "type-promo",
    label: "Announcement",
    pitch: "Bold, type-led motion graphics in your brand colours. Works with nothing but a message and a logo.",
    examples: ["Create an animated product launch announcement", "Animate our brand message for social media"],
    deliverables: [
      { name: "Square announcement", aspect: "1:1", durationS: 12, kind: "cut" },
      { name: "Story cut", aspect: "9:16", durationS: 12, kind: "cut" },
    ],
    beats: [b("hook", 2, "motion-graphics"), b("statement", 2.5, "motion-graphics"), b("statement", 2.5, "motion-graphics"), b("benefit", 2, "motion-graphics"), b("cta", 3, "motion-graphics")],
    voiceover: "none",
    needs: [],
    fallbackRecipe: null,
    motion: "standard",
    direction: "Typography is the visual. Each beat is one confident statement of at most 7 words, building to the call to action.",
  },
  {
    id: "explainer",
    label: "Narrated explainer",
    pitch: "A calmer, narrated walkthrough of how your product works, built from real UI captures.",
    examples: ["Create an engaging product demonstration with narration", "Explain how our app works in 45 seconds"],
    deliverables: [{ name: "Explainer", aspect: "16:9", durationS: 45, kind: "cut" }],
    beats: [b("hook", 2.5, "motion-graphics"), b("problem", 6, "motion-graphics"), b("ui", 6, "ui-capture"), b("ui", 6, "ui-capture"), b("ui", 6, "ui-capture"), b("benefit", 5, "brand-asset"), b("benefit", 5, "motion-graphics"), b("statement", 5, "motion-graphics"), b("cta", 4, "motion-graphics")],
    voiceover: "recommended",
    needs: ["productUrl"],
    fallbackRecipe: "product-demo",
    motion: "calm",
    direction: "Problem → how it works (three real UI moments, narrated) → why it matters → call to action. Narration carries the story; on-screen text stays short.",
  },
  {
    id: "hero-loop",
    label: "Homepage hero loop",
    pitch: "A seamless, text-free background loop for your website hero, exported as MP4 and WebM.",
    examples: ["Make a homepage hero animation", "Create a looping background video for our landing page"],
    deliverables: [
      { name: "Desktop hero loop", aspect: "16:9", durationS: 12, kind: "loop" },
      { name: "Mobile hero loop", aspect: "9:16", durationS: 12, kind: "loop" },
    ],
    beats: [b("ui", 4, "ui-capture", "brand-asset"), b("benefit", 4, "brand-asset", "ui-capture"), b("ui", 4, "ui-capture", "brand-asset")],
    voiceover: "none",
    needs: [],
    fallbackRecipe: null,
    motion: "calm",
    direction: "No text, no logo. Slow, seamless movement across real visuals; the loop point must be invisible.",
  },
  {
    id: "poster",
    label: "Promotional poster",
    pitch: "A print- and social-ready poster with your headline, visual and call to action.",
    examples: ["Create a promotional poster for our launch", "Design a social media poster for the new menu"],
    deliverables: [
      { name: "Poster", aspect: "4:5", durationS: 1, kind: "poster" },
      { name: "Story poster", aspect: "9:16", durationS: 1, kind: "poster" },
    ],
    beats: [b("hook", 1, "brand-asset", "ui-capture"), b("cta", 1, "motion-graphics")],
    voiceover: "none",
    needs: [],
    fallbackRecipe: null,
    motion: "calm",
    direction: "One headline, one supporting line, one call to action, one strong visual.",
  },
];

export function getRecipe(id: string | undefined | null): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}

/* ------------------------------ Intent understanding ------------------------------ */

export interface Intent {
  prompt: string;
  url?: string;
  recipeId: string;
  language: string;
  direction: "rtl" | "ltr";
  /** Explicit main duration ("30-second") or aspect ("vertical", "Instagram") from the prompt. */
  durationS?: number;
  aspect?: Aspect;
  /** Why this recipe was chosen, in plain language. */
  reason: string;
}

const AR_CHARS = /[؀-ۿ]/;

export function detectLanguage(text: string, siteLang?: string): { language: string; direction: "rtl" | "ltr" } {
  const t = text.toLowerCase();
  if (/egyptian|masri|مصري|بالمصري/.test(t)) return { language: "Egyptian Arabic", direction: "rtl" };
  if (/\barabic\b|عربي/.test(t)) return { language: "Arabic", direction: "rtl" };
  if (/\benglish\b/.test(t)) return { language: "English", direction: "ltr" };
  if (AR_CHARS.test(text)) return { language: "Arabic", direction: "rtl" };
  if (siteLang && /^ar/i.test(siteLang)) return { language: "Arabic", direction: "rtl" };
  return { language: "English", direction: "ltr" };
}

export function extractUrl(text: string): string | undefined {
  const m = text.match(/\bhttps?:\/\/[^\s"'<>]+/i) ?? text.match(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|ai|app|co|net|org|dev|eg|me|so|xyz|shop|store)(?:\/[^\s"'<>]*)?/i);
  if (!m) return undefined;
  const raw = m[0].replace(/[).,;]+$/, "");
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** Deterministic intent classifier: keyword rules first, then what the user gave us (URL, photos). */
export function understandIntent(input: { prompt: string; url?: string; photoCount?: number; recipeId?: string }): Intent {
  const prompt = input.prompt.trim();
  const t = prompt.toLowerCase();
  const url = input.url?.trim() || extractUrl(prompt);
  const { language, direction } = detectLanguage(prompt);
  const dur = t.match(/(\d{1,3})\s*(?:-|\s)?\s*(?:s\b|sec|second|ثانية)/);
  const durationS = dur ? Math.min(180, Math.max(5, Number(dur[1]))) : undefined;
  const aspect: Aspect | undefined = /vertical|portrait|reel|tiktok|story|stories|shorts|9:16/.test(t) ? "9:16" : /square|1:1|feed post/.test(t) ? "1:1" : /4:5/.test(t) ? "4:5" : /16:9|landscape|youtube|widescreen/.test(t) ? "16:9" : undefined;
  const pick = (recipeId: string, reason: string): Intent => ({ prompt, url, recipeId, language, direction, durationS, aspect, reason });
  if (input.recipeId && getRecipe(input.recipeId)) return pick(input.recipeId, "You picked this recipe.");
  if (/poster|flyer|\bstill\b|بوستر|إعلان مطبوع/.test(t)) return pick("poster", "You asked for a poster.");
  if (/hero (?:loop|animation|video)|homepage (?:hero|animation|loop)|background (?:video|loop)|\bloop\b/.test(t)) return pick("hero-loop", "You asked for a homepage hero loop.");
  if (/reel|instagram|tiktok|shorts|stories|ريلز|انستجرام|إنستجرام|تيك ?توك/.test(t)) return pick("social-reel", "You mentioned a social platform.");
  if (/explain|explainer|how it works|tutorial|walkthrough|شرح/.test(t)) return pick(url ? "explainer" : "type-promo", url ? "You asked for an explainer." : "An explainer needs your product's website; starting with an announcement instead.");
  if (/announce|announcement|logo animation|brand animation|launch/.test(t) && !url) return pick("type-promo", "An announcement works with just your message and logo.");
  if (url) return pick("product-demo", "You gave a website, so the video can show your real product.");
  if ((input.photoCount ?? 0) >= 2) return pick("social-reel", "You added photos, which suit a quick social reel.");
  if (/commercial|advert|\bad\b|promo|إعلان/.test(t)) return pick("social-reel", "A short promo reel fits an ad without product screens.");
  return pick("type-promo", "Without a website or photos, a type-led announcement gives the strongest result.");
}

/* ------------------------------ Deterministic planner ------------------------------ */

export interface PlannerFacts {
  brandName: string;
  /** Confirmed facts (verified claims). Only these may be stated as product facts. */
  claims: string[];
  /** Lines taken from the user's website (headings, description), already confirmed by the user. */
  siteLines: string[];
  ctaText?: string;
  /** Short brand tagline (e.g. the part of the page title after the name). */
  tagline?: string;
  url?: string;
  productUrl?: string;
  photoCount: number;
}

const CTA_DEFAULT: Record<string, string> = { "Egyptian Arabic": "جرّبه دلوقتي", Arabic: "جرّبه الآن", English: "Try it today" };
const HOOK_DEFAULT: Record<string, (b: string) => string> = {
  "Egyptian Arabic": (b) => `${b}. بشكل مختلف.`,
  Arabic: (b) => `${b}. بشكل مختلف.`,
  English: (b) => `Meet ${b}.`,
};

/** Choose a real call to action from website buttons: skip navigation links, prefer action verbs. */
export function pickCta(candidates: string[]): string | undefined {
  const ok = candidates.map((c) => c.replace(/[←→›»«‹]/g, "").trim()).filter((c) => c.length >= 2 && c.length <= 28 && !/skip|اتخط|تخط|login|log in|sign in|عندي حساب|دخول|menu|القائمة/i.test(c));
  return ok.find((c) => /start|try|get|book|order|buy|join|sign up|download|contact|demo|ابدأ|جر[بّ]|سجّ?ل|احجز|اطلب|اشتر|حمّ?ل|كلمنا|تواصل/i.test(c)) ?? undefined;
}

/** Placeholder line shown in the direction for the user to write — never rendered silently. */
export const WRITE_ME = "✎ ";

function shortLine(s: string, max = 48): string {
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const i = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("،"), cut.lastIndexOf(","));
  return `${(i > max * 0.5 ? cut.slice(0, i) : cut).trim()}…`;
}

/**
 * Build a plan from a recipe without any model call: free, instant and fully deterministic. Text comes only
 * from what the user confirmed (website lines, claims, their prompt); missing lines are left as clearly marked
 * "write this" prompts that creative QA reports, so nothing is invented.
 */
export function recipePlan(intent: Intent, facts: PlannerFacts): DirectorPlan {
  const recipe = getRecipe(intent.recipeId) ?? RECIPES[0];
  const canUi = !!facts.productUrl;
  const canPhotos = facts.photoCount > 0;
  const lines = [...facts.siteLines, ...facts.claims].map((l) => shortLine(l)).filter(Boolean);
  const used = new Set<string>();
  const take = (pred: (l: string) => boolean = () => true) => {
    const l = lines.find((x) => !used.has(x) && pred(x));
    if (l) used.add(l);
    return l;
  };
  const brand = facts.brandName || "Your brand";
  const ctaText = facts.ctaText || CTA_DEFAULT[intent.language] || CTA_DEFAULT.English;
  const ctaUrl = facts.url ? facts.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : "";

  const deliverables = recipe.deliverables.map((d, i) => ({
    name: d.name,
    aspect: i === 0 && intent.aspect && d.kind === "cut" ? intent.aspect : d.aspect,
    durationS: d.kind === "poster" ? 1 : i === 0 || d.kind === "cut" ? (intent.durationS ?? d.durationS) : d.durationS,
  }));
  const main = deliverables[0];
  const share = recipe.beats.reduce((a, x) => a + x.s, 0);
  const scenes: Scene[] = recipe.beats.map((beat, i) => {
    let source = beat.source;
    if (source === "ui-capture" && !canUi) source = beat.fallback;
    if (source === "brand-asset" && !canPhotos) source = beat.fallback === "ui-capture" && canUi ? "ui-capture" : "motion-graphics";
    if (source === "ui-capture" && !canUi) source = "motion-graphics";
    let text = "";
    switch (beat.role) {
      case "hook":
        text = take((l) => l.length <= 40) ?? (HOOK_DEFAULT[intent.language] ?? HOOK_DEFAULT.English)(brand);
        break;
      case "cta":
        // The logo already shows the name: close on the tagline when there is one.
        text = facts.tagline && facts.tagline !== brand ? shortLine(facts.tagline, 40) : brand;
        break;
      case "proof":
        text = facts.claims.find((c) => !used.has(shortLine(c))) ? shortLine(facts.claims.find((c) => !used.has(shortLine(c)))!) : (take() ?? "");
        if (text) used.add(text);
        break;
      default:
        text = take() ?? "";
    }
    const durationS = recipe.deliverables[0].kind === "poster" ? 1 : Math.round(((beat.s / share) * main.durationS) * 10) / 10;
    return {
      title: `${i + 1}. ${beat.role}`,
      durationS,
      narration: "",
      onScreenText: recipe.id === "hero-loop" ? "" : text || `${WRITE_ME}${beat.role === "problem" ? "the problem you solve" : "one benefit"}`,
      prompt: "",
      camera: "",
      constraints: [],
      references: [],
      visualSource: source,
      tool: "",
      role: beat.role,
    };
  });
  // Last scene absorbs rounding so the cut lands exactly on the target length.
  if (recipe.deliverables[0].kind !== "poster") {
    const total = scenes.reduce((a, s) => a + s.durationS, 0);
    scenes[scenes.length - 1].durationS = Math.round((scenes[scenes.length - 1].durationS + main.durationS - total) * 10) / 10;
  }
  const risks: string[] = [];
  if (recipe.needs.includes("productUrl") && !canUi) risks.push("No website was given, so product screens are replaced by motion graphics.");
  if (!canPhotos && recipe.beats.some((x) => x.source === "brand-asset")) risks.push("No brand photos yet: those beats use type-led motion graphics. Add photos to use them.");
  risks.push("No licensed music in the library: the video has no music bed unless you add a track.");
  return DirectorPlanSchema.parse({
    title: `${brand} — ${recipe.label}`,
    logline: intent.prompt.slice(0, 600),
    language: intent.language,
    audience: "",
    tone: recipe.motion === "energetic" ? "energetic, confident" : recipe.motion === "calm" ? "calm, premium" : "clear, confident",
    deliverables,
    script: scenes.map((s) => s.onScreenText).filter((t) => t && !t.startsWith(WRITE_ME)).join("\n"),
    scenes,
    voiceover: { needed: false, language: intent.language, direction: "" },
    music: "",
    questions: [],
    risks,
    recipe: recipe.id,
    cta: { text: recipe.id === "hero-loop" ? "" : ctaText, url: ctaUrl },
    style: { motion: recipe.motion, textScale: 1, captions: true },
  });
}

/** Constraints text given to the AI Director so its plan follows the recipe structure. */
export function recipeConstraints(recipe: Recipe, intent: Intent): string {
  const main = recipe.deliverables[0];
  return [
    `Recipe: ${recipe.label} (set "recipe" to "${recipe.id}").`,
    recipe.direction,
    `Beats in order (role · share of time · preferred visual source → fallback):`,
    ...recipe.beats.map((x, i) => `${i + 1}. ${x.role} · ${x.s} · ${x.source} → ${x.fallback}`),
    `Deliverables: ${recipe.deliverables.map((d) => `"${d.name}" ${d.aspect} ${intent.durationS && d.kind === "cut" ? intent.durationS : d.durationS}s`).join("; ")}${intent.aspect && main.kind === "cut" ? ` (main deliverable aspect: ${intent.aspect})` : ""}.`,
    `Set each scene's "role" to its beat. On-screen text: max ~6 words per beat, max 40 characters; the hook scene is at most 2.5 s.`,
    `Put the call to action in "cta" (text max 4 words; url from the project if known). The last scene is the end card.`,
    `Language: ${intent.language}. Style motion: "${recipe.motion}".`,
  ].join("\n");
}
