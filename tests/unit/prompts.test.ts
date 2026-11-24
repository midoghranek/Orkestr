import { describe, expect, it } from "vitest";
import { DIRECTOR_SYSTEM, EDIT_SYSTEM, MAX_SYSTEM_PROMPT_CHARS, REVIEW_SYSTEM, WRITE_SYSTEM } from "@/server/prompts";

const prompts = { DIRECTOR_SYSTEM, EDIT_SYSTEM, REVIEW_SYSTEM, WRITE_SYSTEM };

describe("system prompts", () => {
  it.each(Object.entries(prompts))("%s fits on a command line", (_name, text) => {
    expect(text.length).toBeGreaterThan(200);
    expect(text.length).toBeLessThanOrEqual(MAX_SYSTEM_PROMPT_CHARS);
    // Passed as one argv entry: a NUL would truncate it.
    expect(text).not.toContain("\0");
  });

  it.each(Object.entries(prompts))("%s forbids invented content", (_name, text) => {
    expect(text).toMatch(/never invent|only what is visible/i);
  });

  it.each(Object.entries(prompts))("%s treats supplied content as data, not instructions", (_name, text) => {
    expect(text).toMatch(/instructions/i);
  });

  it("the Director prompt carries the numbers creative QA enforces", () => {
    for (const rule of ["within 0.5 s", "at most 2.5 s", "1.5 to 6 s", "up to 7 s", "17 characters per second", "at most 3"]) expect(DIRECTOR_SYSTEM).toContain(rule);
    for (const source of ["brand-asset", "ui-capture", "motion-graphics", "generated-image", "generated-video", "stock", "placeholder"]) expect(DIRECTOR_SYSTEM).toContain(`"${source}"`);
    expect(DIRECTOR_SYSTEM).toContain("Verified claims");
    expect(DIRECTOR_SYSTEM).toContain("Website content");
  });

  it("the edit prompt asks for operations only", () => {
    expect(EDIT_SYSTEM).toMatch(/never a rewritten plan, code or commands/);
    expect(EDIT_SYSTEM).toContain("Verified claims");
  });

  it("the review prompt defines every verdict and severity in the schema", () => {
    for (const word of ["pass", "needs_changes", "fail", "info", "minor", "major", "critical"]) expect(REVIEW_SYSTEM).toContain(`"${word}"`);
  });
});
