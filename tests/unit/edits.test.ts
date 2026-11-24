import { describe, expect, it } from "vitest";
import { DirectorPlanSchema } from "@/shared/schema";
import { applyEdits, needsAi, parseInstruction } from "@/server/edits";

const base = DirectorPlanSchema.parse({
  title: "T",
  logline: "",
  language: "English",
  audience: "",
  tone: "",
  deliverables: [{ name: "Main", aspect: "16:9", durationS: 20 }],
  script: "",
  voiceover: { needed: false },
  scenes: [2, 6, 6, 6].map((d, i) => ({ title: `s${i + 1}`, durationS: d, onScreenText: `Line ${i + 1}` })),
});
const total = (p: typeof base) => p.scenes.reduce((a, s) => a + s.durationS, 0);

describe("edit operations", () => {
  it("retime keeps the total length", () => {
    const { plan } = applyEdits(base, [{ op: "retime", scene: 2, durationS: 8 }]);
    expect(plan.scenes[1].durationS).toBe(8);
    expect(total(plan)).toBeCloseTo(20, 0);
  });
  it("remove scene redistributes its time", () => {
    const { plan } = applyEdits(base, [{ op: "removeScene", scene: 3 }]);
    expect(plan.scenes).toHaveLength(3);
    expect(total(plan)).toBeCloseTo(20, 0);
  });
  it("setTotalDuration rescales to the exact length", () => {
    const { plan } = applyEdits(base, [{ op: "setTotalDuration", deliverable: 1, durationS: 15 }]);
    expect(total(plan)).toBeCloseTo(15, 5);
    expect(plan.deliverables[0].durationS).toBe(15);
  });
  it("rejects invalid reorders", () => {
    expect(() => applyEdits(base, [{ op: "reorderScenes", order: [1, 1, 2, 3] }])).toThrow(/every scene once/);
  });
  it("leaves unrelated scenes untouched on a text edit (so their renders are reused)", () => {
    const { plan } = applyEdits(base, [{ op: "setSceneText", scene: 2, field: "onScreenText", value: "New" }]);
    expect(plan.scenes.map((s) => s.onScreenText)).toEqual(["Line 1", "New", "Line 3", "Line 4"]);
    expect(plan.scenes.map((s) => s.durationS)).toEqual(base.scenes.map((s) => s.durationS));
  });
});

describe("natural-language requests", () => {
  const ops = (t: string) => parseInstruction(t, base)?.ops ?? null;
  it.each([
    ["Slow down the animations", { op: "setStyle", motion: "calm" }],
    ["Make it more cinematic", { op: "setStyle", motion: "calm" }],
    ["Make the text easier to read", { op: "setStyle", textScale: 1.2 }],
    ["make it 15 seconds", { op: "setTotalDuration", deliverable: 1, durationS: 15 }],
    ["Create a shorter Instagram version", { op: "addDeliverable", name: "Instagram cut 10s", aspect: "9:16", durationS: 10 }],
    ['Change the call to action to "Book a table"', { op: "setCta", text: "Book a table" }],
    ["Remove the third scene", { op: "removeScene", scene: 3 }],
    ['Replace the second scene text with "Fresh every morning"', { op: "setSceneText", scene: 2, field: "onScreenText", value: "Fresh every morning" }],
    ["swap scenes 2 and 3", { op: "reorderScenes", order: [1, 3, 2, 4] }],
  ])("%s", (text, expected) => {
    expect(ops(text)).toContainEqual(expected);
  });
  it("makes the opening punchier", () => {
    expect(ops("Make the first three seconds more exciting")).toContainEqual({ op: "setStyle", motion: "energetic" });
  });
  it("returns null for creative rewrites, which need the AI Director", () => {
    expect(parseInstruction("Use Egyptian Arabic", base)).toBeNull();
    expect(needsAi("Use Egyptian Arabic")).toBe(true);
    expect(needsAi("Make another version with a different visual style")).toBe(true);
  });
});
