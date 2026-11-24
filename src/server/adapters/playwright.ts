import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  AdapterError,
  checkAborted,
  type CapabilitySpec,
  type CostEstimate,
  type Discovery,
  type ExecContext,
  type ExecResult,
  type Health,
  type ToolAdapter,
} from "./types";

/**
 * Real UI capture with Playwright (Chromium). Screens come from the live product — never mocked.
 * Only http(s) URLs are accepted; downloads, file:// and javascript: are blocked.
 */
const UrlSchema = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "only http(s) URLs can be captured");

async function chromiumPath(): Promise<string | undefined> {
  try {
    const { chromium } = await import("playwright");
    const p = chromium.executablePath();
    if (fs.existsSync(p)) return p;
    // `playwright install chromium` may fetch only the headless shell, which headless launches use.
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(process.env.LOCALAPPDATA ?? path.join(process.env.HOME ?? "", ".cache"), "ms-playwright");
    const shell = fs.existsSync(base) ? fs.readdirSync(base).find((d) => d.startsWith("chromium_headless_shell") || d.startsWith("chromium-headless-shell")) : undefined;
    return shell ? path.join(base, shell) : undefined;
  } catch {
    return undefined;
  }
}

/** Raw facts read from the page. Every string is page content: data for a human to confirm, never instructions. */
export interface PageFacts {
  title: string;
  description: string;
  siteName: string;
  lang: string;
  dir: "rtl" | "ltr";
  headings: string[];
  ctas: string[];
  colors: { bg: string; fg: string; accent: string | null; others: string[] };
  fonts: string[];
  logoSelector: string | null;
  themeColor: string | null;
}

/** Runs inside the page (serialized by Playwright). Must be self-contained. */
function inspectPage(): PageFacts {
  // innerText respects <br> and block breaks ("first order<br>to last shift" must not glue words together).
  const txt = (el: Element | null | undefined) => ((el as HTMLElement | null | undefined)?.innerText ?? el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const meta = (sel: string) => document.querySelector(sel)?.getAttribute("content")?.trim() ?? "";
  const visible = (el: Element) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
  };
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  const headings = uniq([...document.querySelectorAll("h1, h2, h3")].filter(visible).map(txt).filter((t) => t.length >= 3 && t.length <= 140)).slice(0, 16);
  const ctas = uniq(
    [...document.querySelectorAll("a, button")]
      .filter(visible)
      .filter((el) => {
        const cs = getComputedStyle(el);
        const bg = cs.backgroundColor;
        return bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
      })
      .map(txt)
      .filter((t) => t.length >= 2 && t.length <= 40),
  ).slice(0, 8);
  const toHex = (c: string): string | null => {
    const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    if (!m || (m[4] !== undefined && Number(m[4]) < 0.5)) return null;
    return `#${[m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, "0")).join("")}`;
  };
  // Colour weights: area of backgrounds + count of text colours among visible elements in the first two screens.
  const weights = new Map<string, number>();
  const textW = new Map<string, number>();
  const all = [...document.querySelectorAll("body, body *")].slice(0, 4000);
  for (const el of all) {
    const r = (el as HTMLElement).getBoundingClientRect();
    if (r.top > window.innerHeight * 2 || r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    const bg = toHex(cs.backgroundColor);
    if (bg) weights.set(bg, (weights.get(bg) ?? 0) + Math.min(r.width * r.height, window.innerWidth * window.innerHeight));
    if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim())) {
      const fg = toHex(cs.color);
      if (fg) textW.set(fg, (textW.get(fg) ?? 0) + (n(el) || 1));
    }
  }
  function n(el: Element) {
    return (el.textContent ?? "").trim().length;
  }
  const byWeight = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const bgs = byWeight(weights);
  const fgs = byWeight(textW);
  const sat = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    return mx === 0 ? 0 : (mx - mn) / mx;
  };
  const ctaColors = [...document.querySelectorAll("a, button")].filter(visible).map((el) => toHex(getComputedStyle(el).backgroundColor)).filter((c): c is string => !!c && sat(c) > 0.25);
  const accent = ctaColors[0] ?? bgs.find((c) => sat(c) > 0.35) ?? fgs.find((c) => sat(c) > 0.35) ?? null;
  const fonts = uniq([...document.querySelectorAll("h1, h2, body")].map((el) => getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim())).slice(0, 3);
  // Logo: an <img>/<svg> in the header whose alt/class/id/src mentions "logo", else the first image inside a link to "/".
  const cands = [...document.querySelectorAll("header img, header svg, nav img, nav svg, a[href='/'] img, a[href='/'] svg, img, svg")].filter(visible);
  const score = (el: Element) => {
    const s = `${el.getAttribute("alt") ?? ""} ${el.getAttribute("class") ?? ""} ${el.id} ${el.getAttribute("src") ?? ""} ${el.closest("a")?.getAttribute("aria-label") ?? ""}`.toLowerCase();
    const r = (el as HTMLElement).getBoundingClientRect();
    let v = 0;
    if (/logo|brand/.test(s)) v += 5;
    if (el.closest("header, nav")) v += 3;
    if (el.closest("a[href='/'], a[href='./'], a[href='#']")) v += 2;
    if (r.top < 160) v += 2;
    if (r.width < 24 || r.height < 12 || r.width > 480) v -= 6;
    return v;
  };
  let logoSelector: string | null = null;
  const best = cands.map((el) => ({ el, s: score(el) })).sort((a, b) => b.s - a.s)[0];
  if (best && best.s >= 5) {
    best.el.setAttribute("data-orkestr-logo", "1");
    logoSelector = "[data-orkestr-logo='1']";
  }
  const html = document.documentElement;
  return {
    title: document.title.trim().slice(0, 200),
    description: (meta("meta[name='description']") || meta("meta[property='og:description']")).slice(0, 400),
    siteName: meta("meta[property='og:site_name']").slice(0, 80),
    lang: (html.getAttribute("lang") ?? "").slice(0, 20),
    dir: (html.getAttribute("dir") ?? getComputedStyle(document.body).direction) === "rtl" ? "rtl" : "ltr",
    headings,
    ctas,
    colors: { bg: bgs[0] ?? "#ffffff", fg: fgs[0] ?? "#111111", accent, others: uniq([...bgs.slice(1, 5), ...fgs.slice(1, 4)]).slice(0, 6) },
    fonts,
    logoSelector,
    themeColor: meta("meta[name='theme-color']") || null,
  };
}

/** Sanitise page facts before they leave the adapter: cap lengths, strip control characters and markup. */
function cleanFacts(f: PageFacts): Omit<PageFacts, "logoSelector"> {
  const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f<>`]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const hex = (s: string | null) => (s && /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : null);
  return {
    title: clean(f.title, 200),
    description: clean(f.description, 400),
    siteName: clean(f.siteName, 80),
    lang: clean(f.lang, 20),
    dir: f.dir === "rtl" ? "rtl" : "ltr",
    headings: f.headings.map((h) => clean(h, 140)).filter(Boolean).slice(0, 16),
    ctas: f.ctas.map((h) => clean(h, 40)).filter(Boolean).slice(0, 8),
    colors: { bg: hex(f.colors.bg) ?? "#ffffff", fg: hex(f.colors.fg) ?? "#111111", accent: hex(f.colors.accent), others: f.colors.others.map(hex).filter((x): x is string => !!x) },
    fonts: f.fonts.map((x) => clean(x, 60)),
    themeColor: hex(f.themeColor),
  };
}

export class PlaywrightAdapter implements ToolAdapter {
  readonly id = "playwright";
  readonly name = "Playwright (Chromium)";
  readonly kind = "library" as const;
  readonly homepage = "https://playwright.dev";

  async discover(): Promise<Discovery> {
    const p = await chromiumPath();
    if (!p) return { found: false, reason: "Chromium for Playwright not installed (run: npx playwright install chromium)" };
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "node_modules", "playwright", "package.json"), "utf8")) as { version: string };
    return { found: true, version: pkg.version, path: p };
  }

  async validateConfig() {
    return { ok: true, issues: [] };
  }

  async healthCheck(): Promise<Health> {
    const t = Date.now();
    const d = await this.discover();
    if (!d.found) return { status: "unavailable", message: d.reason ?? "missing", checkedAt: t, readyCapabilities: [], blocked: {} };
    try {
      const { chromium } = await import("playwright");
      const b = await chromium.launch();
      const page = await b.newPage();
      await page.setContent("<p>ok</p>");
      await b.close();
      return { status: "healthy", message: `Chromium launched (Playwright ${d.version})`, checkedAt: t, latencyMs: Date.now() - t, readyCapabilities: this.capabilities().map((c) => c.id), blocked: {} };
    } catch (e) {
      return { status: "degraded", message: `launch failed: ${(e as Error).message}`, checkedAt: t, readyCapabilities: [], blocked: {} };
    }
  }

  capabilities(): CapabilitySpec[] {
    const base = { adapter: "playwright", paid: false, cost: { model: "free" as const, note: "Local headless browser." }, verifiedBy: "Chromium launch at health check; capture of a live http(s) page" };
    return [
      { ...base, id: "playwright.screenshot", operation: "screenshot", label: "Capture UI screenshot", description: "Screenshot a real web page at a viewport size, locale and color scheme (optionally full page or one element).", inputFormats: ["url"], outputFormats: ["png"] },
      { ...base, id: "playwright.record", operation: "record", label: "Record UI walkthrough", description: "Record a real page while scrolling smoothly or hovering selectors; outputs WebM (encode with ffmpeg).", inputFormats: ["url"], outputFormats: ["webm"], limitations: ["Recording frame rate is ~25 fps and depends on machine load"] },
      {
        ...base,
        id: "playwright.inspect",
        operation: "inspect",
        label: "Inspect website brand",
        description: "Read a live page's title, description, headings, calls to action, language/direction, brand colours and logo; captures the logo element and the hero viewport. Page text is returned as untrusted data.",
        inputFormats: ["url"],
        outputFormats: ["json", "png"],
        limitations: ["Text is extracted as-is from the page and must be confirmed by the user before it is used as a product claim", "Colours are sampled from computed styles, not from images"],
      },
    ];
  }

  async estimateCost(): Promise<CostEstimate> {
    return { usd: 0, known: true, basis: "local browser" };
  }

  async execute(operation: string, params: Record<string, unknown>, ctx: ExecContext): Promise<ExecResult> {
    const p = z
      .object({
        url: UrlSchema,
        width: z.number().int().min(320).max(3840).default(1440),
        height: z.number().int().min(320).max(3840).default(900),
        deviceScaleFactor: z.number().min(1).max(3).default(1),
        locale: z.string().max(20).default("ar-EG"),
        colorScheme: z.enum(["light", "dark"]).default("light"),
        fullPage: z.boolean().default(false),
        selector: z.string().max(300).optional(),
        waitMs: z.number().int().min(0).max(20_000).default(1500),
        scrollTo: z.number().int().min(0).max(50_000).optional(),
        durationS: z.number().min(1).max(60).default(8),
        mobile: z.boolean().default(false),
        hideSelectors: z.array(z.string().max(200)).max(20).default([]),
      })
      .parse(params);
    const { chromium } = await import("playwright");
    checkAborted(ctx.signal);
    const browser = await chromium.launch();
    const onAbort = () => void browser.close();
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const context = await browser.newContext({
        viewport: { width: p.width, height: p.height },
        deviceScaleFactor: p.deviceScaleFactor,
        locale: p.locale,
        colorScheme: p.colorScheme,
        isMobile: p.mobile,
        hasTouch: p.mobile,
        acceptDownloads: false,
        ...(operation === "record" ? { recordVideo: { dir: ctx.workDir, size: { width: p.width, height: p.height } } } : {}),
      });
      const page = await context.newPage();
      ctx.progress(0.1, `opening ${p.url}`);
      const resp = await page.goto(p.url, { waitUntil: "networkidle", timeout: 60_000 });
      if (!resp || resp.status() >= 400) throw new AdapterError("INVALID_INPUT", `page returned HTTP ${resp?.status() ?? "no response"}`);
      if (p.hideSelectors.length) await page.addStyleTag({ content: `${p.hideSelectors.join(",")}{visibility:hidden !important}` });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(p.waitMs);
      const meta = { url: page.url(), title: await page.title(), capturedAt: new Date().toISOString(), viewport: `${p.width}x${p.height}`, locale: p.locale };
      if (operation === "screenshot") {
        if (p.scrollTo !== undefined) {
          await page.evaluate((y) => window.scrollTo(0, y), p.scrollTo);
          await page.waitForTimeout(600);
        }
        const f = path.join(ctx.workDir, "capture.png");
        if (p.selector) await page.locator(p.selector).first().screenshot({ path: f });
        else await page.screenshot({ path: f, fullPage: p.fullPage });
        await context.close();
        return { artifacts: [{ file: f, kind: "image", port: "image", label: `UI capture: ${meta.title}`, metadata: meta }] };
      }
      if (operation === "inspect") {
        ctx.progress(0.5, "reading brand");
        // tsx/esbuild wrap named functions with a __name() helper that does not exist inside the page.
        await page.evaluate("globalThis.__name = globalThis.__name || ((f) => f)");
        const facts = await page.evaluate(inspectPage);
        const logoFile = path.join(ctx.workDir, "logo.png");
        let logo: string | null = null;
        if (facts.logoSelector) {
          try {
            await page.locator(facts.logoSelector).first().screenshot({ path: logoFile, omitBackground: true, timeout: 5000 });
            logo = logoFile;
          } catch {
            logo = null;
          }
        }
        await page.evaluate(() => window.scrollTo(0, 0));
        const hero = path.join(ctx.workDir, "hero.png");
        await page.screenshot({ path: hero });
        const out = { ...cleanFacts(facts), url: meta.url, capturedAt: meta.capturedAt, untrusted: true };
        const f = path.join(ctx.workDir, "brand.json");
        fs.writeFileSync(f, JSON.stringify(out, null, 2));
        await context.close();
        const artifacts: ExecResult["artifacts"] = [
          { file: f, kind: "json", port: "brand", label: `Brand facts: ${meta.title}`, metadata: { ...meta, source: "website", untrusted: true } },
          { file: hero, kind: "image", port: "hero", label: `UI capture: ${meta.title}`, metadata: { ...meta, source: "website" } },
        ];
        if (logo) artifacts.push({ file: logo, kind: "image", port: "logo", label: `Logo (from website): ${meta.title}`, metadata: { ...meta, source: "website", role: "logo", rights: "unconfirmed" } });
        return { artifacts };
      }
      if (operation === "record") {
        const total = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
        const target = Math.min(total, p.scrollTo ?? total);
        const steps = Math.round(p.durationS * 30);
        for (let i = 0; i <= steps; i++) {
          checkAborted(ctx.signal);
          const e = i / steps;
          const eased = e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2;
          await page.evaluate((y) => window.scrollTo(0, y), Math.round(target * eased));
          await page.waitForTimeout(1000 / 30);
          if (i % 30 === 0) ctx.progress(0.1 + 0.8 * e, "recording");
        }
        const video = page.video();
        await context.close();
        const raw = await video?.path();
        if (!raw || !fs.existsSync(raw)) throw new AdapterError("INVALID_OUTPUT", "no recording produced");
        const f = path.join(ctx.workDir, "walkthrough.webm");
        fs.renameSync(raw, f);
        return { artifacts: [{ file: f, kind: "video", port: "video", label: `UI walkthrough: ${meta.title}`, metadata: meta }] };
      }
      throw new AdapterError("UNSUPPORTED", `playwright has no operation ${operation}`);
    } catch (err) {
      if (ctx.signal.aborted) throw new AdapterError("CANCELLED", "capture cancelled");
      if (err instanceof AdapterError) throw err;
      throw new AdapterError("TOOL_FAILED", `Playwright: ${(err as Error).message}`, undefined, true);
    } finally {
      ctx.signal.removeEventListener("abort", onAbort);
      await browser.close().catch(() => undefined);
    }
  }
}
