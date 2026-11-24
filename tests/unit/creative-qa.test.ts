import { describe, expect, it } from "vitest";
import { DirectorPlanSchema, type DirectorPlan } from "@/shared/schema";
import { balanceLine, contrastRatio, improvePlan, reviewPlan } from "@/server/creative-qa";

const plan = (over: Omit<Partial<DirectorPlan>, "scenes"> & { scenes: Record<string, unknown>[] }): DirectorPlan =>
  DirectorPlanSchema.parse({
    title: "T",
    logline: "",
    language: "English",
    audience: "",
    tone: "",
    deliverables: [{ name: "Main", aspect: "16:9", durationS: 20 }],
    script: "",
    voiceover: { needed: false },
    recipe: "product-demo",
    cta: { text: "Try it", url: "acme.io" },
    ...over,
    scenes: over.scenes.map((s, i) => ({ title: `s${i}`, durationS: 4, onScreenText: "Short line", ...s })),
  });

describe("creative QA", () => {
  it("flags a slow hook and fixes it while keeping the total length", () => {
    const p = plan({ scenes: [{ durationS: 5 }, { durationS: 5 }, { durationS: 5 }, { durationS: 5 }] });
    expect(reviewPlan(p).issues.map((i) => i.id)).toContain("hook-length");
    const { plan: fixed, report } = improvePlan(p);
    expect(fixed.scenes[0].durationS).toBe(2);
    expect(fixed.scenes.reduce((a, s) => a + s.durationS, 0)).toBeCloseTo(20, 1);
    expect(report.issues.map((i) => i.id)).not.toContain("hook-length");
    expect(report.fixes.length).toBeGreaterThan(0);
  });

  it("gives hard-to-read scenes more time, taken from scenes with slack", () => {
    const p = plan({ scenes: [{ durationS: 2 }, { durationS: 1.6, onScreenText: "This is a very long line of on-screen copy that nobody can read" }, { durationS: 9.4 }, { durationS: 7 }] });
    const { plan: fixed } = improvePlan(p);
    expect(fixed.scenes[1].durationS).toBeGreaterThan(3);
    expect(fixed.scenes.reduce((a, s) => a + s.durationS, 0)).toBeCloseTo(20, 1);
  });

  it("replaces unproducible sources and stops after a bounded number of passes", () => {
    const p = plan({ scenes: [{ durationS: 2 }, { durationS: 6, visualSource: "generated-video" }, { durationS: 6 }, { durationS: 6 }] });
    const { plan: fixed } = improvePlan(p, {}, 2);
    expect(fixed.scenes[1].visualSource).toBe("motion-graphics");
  });

  it("flags numbers that are not confirmed facts, softly when they come from the user's own site", () => {
    const p = plan({ scenes: [{ durationS: 2, onScreenText: "Save 40% today" }, { durationS: 6 }, { durationS: 6 }, { durationS: 6 }] });
    expect(reviewPlan(p).issues.find((i) => i.id === "fact-1")?.severity).toBe("major");
    expect(reviewPlan(p, { siteText: "Customers save 40% on fees" }).issues.find((i) => i.id === "fact-1")?.severity).toBe("minor");
    expect(reviewPlan(p, { claims: ["Save 40% on fees"] }).issues.find((i) => i.id === "fact-1")).toBeUndefined();
  });

  it("checks palette contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    const p = plan({ scenes: [{ durationS: 2 }, { durationS: 6 }, { durationS: 6 }, { durationS: 6 }] });
    expect(reviewPlan(p, { palette: { fg: "#777777", bg: "#888888" } }).issues.map((i) => i.id)).toContain("contrast");
  });

  it("balances long lines over two rows", () => {
    expect(balanceLine("one two three four five six seven eight nine ten eleven", 30)).toContain("\n");
    expect(balanceLine("short", 30)).toBe("short");
  });
});
