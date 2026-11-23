import { beforeAll, describe, expect, it } from "vitest";
import { freshEnv } from "../helpers";
import { closeDb } from "@/server/db";
import { createProject, updateProject } from "@/server/projects";
import { getSettings, updateSettings, SettingsSchema } from "@/server/settings";
import { onlyProvided } from "@/server/util/ids";

describe("partial updates never reset untouched fields (Zod 4 .partial() keeps defaults)", () => {
  beforeAll(() => {
    freshEnv("patch");
    closeDb();
  });

  it("project patch keeps brief, budget and verified claims", () => {
    const p = createProject({ name: "P", brief: "the brief", budgetUsd: 12, settings: { verifiedClaims: ["claim A"], language: "ar" } });
    const u = updateProject(p.id, { settings: { productUrl: "https://example.com" } } as never);
    expect(u.brief).toBe("the brief");
    expect(u.budgetUsd).toBe(12);
    expect(u.settings.verifiedClaims).toEqual(["claim A"]);
    expect(u.settings.language).toBe("ar");
    expect(u.settings.productUrl).toBe("https://example.com");
  });

  it("settings patch keeps other settings", () => {
    updateSettings({ importRoots: ["C:\brand"], concurrency: 2 });
    const raw = { concurrency: 3 };
    updateSettings(onlyProvided(raw, SettingsSchema.partial().parse(raw)));
    expect(getSettings()).toMatchObject({ concurrency: 3, importRoots: ["C:\brand"] });
  });
});
