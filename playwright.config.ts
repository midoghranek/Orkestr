import { defineConfig } from "@playwright/test";

/** Browser tests of the studio. Start the app first (`npm run dev`); tests never approve or spend anything. */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.ORKESTR_URL ?? "http://127.0.0.1:4317",
    viewport: { width: 1600, height: 1000 },
    screenshot: "only-on-failure",
  },
});
