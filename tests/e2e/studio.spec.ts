import { expect, test, type Page } from "@playwright/test";

// Runs against the dummy `acme-cafe` demo project: `npm run seed:demo`, then `npm run dev`, then `npm run test:e2e`.

/** Collect console errors so a page that "renders" but throws still fails. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|favicon|net::ERR_ABORTED/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/screens/${name}.png`, fullPage: false });

test("dashboard shows studio status, approvals and projects", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("worker running")).toBeVisible();
  await expect(page.getByText("Needs your decision")).toBeVisible();
  await expect(page.getByRole("link", { name: /Acme Café/i }).first()).toBeVisible();
  await shot(page, "dashboard");
  expect(errors).toEqual([]);
});

test("settings lists verified tools and honest gaps", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/settings");
  await expect(page.getByText("FFmpeg / FFprobe").first()).toBeVisible();
  await expect(page.getByText(/ComfyUI/).first()).toBeVisible();
  await expect(page.getByText(/ElevenLabs/).first()).toBeVisible();
  await shot(page, "settings");
  expect(errors).toEqual([]);
});

test("project overview, storyboard, assets and preview render for the demo project", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/projects/acme-cafe");
  await expect(page.getByRole("heading", { name: "Acme Café (demo)" })).toBeVisible();
  await expect(page.getByText("Workflows")).toBeVisible();
  await shot(page, "project-overview");

  await page.getByRole("link", { name: "Storyboard" }).click();
  await expect(page.getByText(/Espresso bar/).first()).toBeVisible();
  await shot(page, "storyboard");

  await page.getByRole("link", { name: "Assets" }).click();
  await expect(page.getByText(/Logo · horizontal/).first()).toBeVisible();
  await shot(page, "assets");

  await page.getByRole("link", { name: "Preview" }).click();
  await expect(page.locator("video").first()).toBeVisible();
  await shot(page, "preview");

  await page.getByRole("link", { name: "AI Director" }).click();
  await expect(page.getByText(/Acme Café — Morning ritual/).first()).toBeVisible();
  await shot(page, "director");
  expect(errors).toEqual([]);
});

test("flow editor renders the demo graph and validates edits", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/projects/acme-cafe/flows");
  await page.locator("main a[href*='/flows/wf_']").first().click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible();
  expect(await page.locator(".react-flow__node").count()).toBeGreaterThan(10);
  await expect(page.getByText("valid", { exact: true })).toBeVisible();
  await shot(page, "flow-editor");

  // Unavailable generators are visible but cannot be added.
  await page.getByPlaceholder("Search nodes…").fill("Generate Video");
  await expect(page.getByRole("button", { name: /Generate Video \(AI\)/ })).toBeVisible();

  // Adding an Encode node with no input makes the graph invalid (live validation), without saving.
  await page.getByPlaceholder("Search nodes…").fill("Encode");
  await page.getByRole("button", { name: /^Encode/ }).click();
  await expect(page.getByText(/\d+ issues?/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("render queue lists runs and pending approvals (read-only)", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/queue");
  await expect(page.getByText(/approv/i).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible();
  await shot(page, "queue");
  expect(errors).toEqual([]);
});

test("API rejects non-local hosts and cross-origin writes", async ({ request }) => {
  const r1 = await request.get("/api/projects", { headers: { Host: "attacker.example" } });
  expect(r1.status()).toBe(403);
  const r2 = await request.post("/api/projects", { headers: { Origin: "https://attacker.example" }, data: { name: "x" } });
  expect(r2.status()).toBe(403);
  const r3 = await request.get("/api/exports/file?projectId=x&name=..%2F..%2Fsecret.key");
  expect([400, 403, 404]).toContain(r3.status());
});
