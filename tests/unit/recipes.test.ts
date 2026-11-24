import { describe, expect, it } from "vitest";
import { detectLanguage, extractUrl, pickCta, recipePlan, understandIntent, WRITE_ME, RECIPES } from "@/server/recipes";

describe("intent understanding", () => {
  it.each([
    ["Create a professional commercial for my SaaS product", "https://acme.io", "product-demo"],
    ["Make a 30-second Instagram advertisement", undefined, "social-reel"],
    ["Create an animated product launch video", undefined, "type-promo"],
    ["Turn my website into a cinematic promotional video", "https://acme.io", "product-demo"],
    ["Make a homepage hero animation", undefined, "hero-loop"],
    ["Create a promotional poster for our launch", undefined, "poster"],
    ["Create an engaging product demonstration, explain how it works", "https://acme.io", "explainer"],
  ])("%s → %s", (prompt, url, recipe) => {
    expect(understandIntent({ prompt, url }).recipeId).toBe(recipe);
  });

  it("reads duration, aspect and language from the prompt", () => {
    const i = understandIntent({ prompt: "Create an Egyptian Arabic 15 second vertical ad for my café" });
    expect(i.durationS).toBe(15);
    expect(i.aspect).toBe("9:16");
    expect(i.language).toBe("Egyptian Arabic");
    expect(i.direction).toBe("rtl");
  });

  it("finds a website in free text", () => {
    expect(extractUrl("a demo of kafeeh.com please")).toBe("https://kafeeh.com");
    expect(extractUrl("see https://acme.io/pricing.")).toBe("https://acme.io/pricing");
    expect(extractUrl("no site here")).toBeUndefined();
  });

  it("detects Arabic script", () => {
    expect(detectLanguage("إعلان لكافيه").direction).toBe("rtl");
    expect(detectLanguage("an ad").language).toBe("English");
  });

  it("never picks a skip link or login as the call to action", () => {
    expect(pickCta(["اتخطى للمحتوى", "ابدأ مجانًا", "عندي حساب"])).toBe("ابدأ مجانًا");
    expect(pickCta(["Skip to content", "Log in", "Start free trial"])).toBe("Start free trial");
    expect(pickCta(["About", "Pricing"])).toBeUndefined();
  });
});

describe("recipe planner (free, deterministic)", () => {
  const facts = { brandName: "Acme", claims: [], siteLines: ["Invoices in one click", "Paid twice as fast"], url: "https://acme.io", productUrl: "https://acme.io", photoCount: 0 };

  it("fits the target length exactly and follows the recipe beats", () => {
    for (const r of RECIPES.filter((x) => x.deliverables[0].kind !== "poster")) {
      const plan = recipePlan(understandIntent({ prompt: "x", recipeId: r.id, url: "https://acme.io" }), facts);
      const sum = plan.scenes.reduce((a, s) => a + s.durationS, 0);
      expect(Math.abs(sum - plan.deliverables[0].durationS)).toBeLessThan(0.11);
      expect(plan.scenes.map((s) => s.role)).toEqual(r.beats.map((b) => b.role));
      expect(plan.recipe).toBe(r.id);
    }
  });

  it("uses only given words and marks missing lines instead of inventing them", () => {
    const plan = recipePlan(understandIntent({ prompt: "Product video", url: "https://acme.io" }), facts);
    const texts = plan.scenes.map((s) => s.onScreenText);
    expect(texts).toContain("Invoices in one click");
    for (const t of texts) expect(t.startsWith(WRITE_ME) || ["Invoices in one click", "Paid twice as fast", "Meet Acme.", "Acme"].includes(t)).toBe(true);
  });

  it("falls back from product screens to motion graphics without a website", () => {
    const plan = recipePlan(understandIntent({ prompt: "commercial", recipeId: "product-demo" }), { ...facts, productUrl: undefined });
    expect(plan.scenes.some((s) => s.visualSource === "ui-capture")).toBe(false);
    expect(plan.risks.join(" ")).toMatch(/No website/);
  });
});
