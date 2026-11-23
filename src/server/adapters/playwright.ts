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
