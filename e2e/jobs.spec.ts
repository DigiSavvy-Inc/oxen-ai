import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { uploadTiles, type Uploaded } from "./helpers.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const MODEL = {
  id: "e2e-jobs-reference-to-video",
  display_name: "E2E Jobs",
  endpoint: "/videos/generate",
  capabilities: { input: ["text", "image"], output: ["video"] },
};

function tile(n: number): string {
  return `data:image/png;base64,${readFileSync(join(FIXTURES, `tile-${n}.png`)).toString("base64")}`;
}

/**
 * The local Studio has no Oxen key and no runs, so the model, its controls, and the
 * project's jobs are answered here. The project, its references, and uploads are real.
 */
async function stubModel(page: Page) {
  await page.route("**/api/auth/me", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ json: { user: { ...body.user, hasOxenKey: true } } });
  });
  await page.route(/\/api\/models(\?.*)?$/, (route) =>
    route.fulfill({ json: { mode: "reference-to-video", models: [MODEL] } }),
  );
  await page.route(`**/api/models/${MODEL.id}`, (route) =>
    route.fulfill({
      json: {
        model: MODEL,
        controls: {
          modelId: MODEL.id,
          aspectRatios: null,
          duration: null,
          seed: false,
          generateAudio: false,
          quality: null,
          resolution: null,
          outputFormat: null,
          background: null,
          mentions: true,
          pricing: null,
          slots: [{ field: "input_images", kind: "image", required: false, maxItems: 4, asArray: true }],
        },
      },
    }),
  );
}

function jobFor(projectId: string, files: Uploaded[], prompt: string) {
  const now = Math.floor(Date.now() / 1000);
  return {
    batchId: `batch-${projectId}`,
    projectId,
    createdAt: now - 90,
    mode: "reference-to-video",
    model: MODEL.id,
    prompt: `Soft window light.\n\n${prompt}`,
    basePrompt: prompt,
    looks: [{ id: "look-1", name: "Window light" }],
    refs: [
      { kind: "image", number: 1, role: "character", name: "lead.png", key: files[0]!.key, url: tile(1), thumbUrl: tile(1) },
      { kind: "image", number: 2, role: "background", name: "room.png", key: files[1]!.key, url: tile(2), thumbUrl: tile(2) },
      { kind: "image", number: 3, role: "object", name: "lost.png", key: "u/someone/lost.png", url: null, thumbUrl: null },
    ],
    settings: { aspect_ratio: "16:9", num_generations: 1 },
    multiPrompt: null,
    cost: 0.12,
    status: "succeeded",
    outputs: [
      {
        id: `out-${projectId}`,
        status: "succeeded",
        mediaType: "image",
        resultUrl: tile(3),
        resultKey: files[2]!.key,
        thumbUrl: null,
        errorMessage: null,
        createdAt: now - 90,
        updatedAt: now - 48,
        tags: [],
      },
    ],
  };
}

/** A project with one stubbed job, the model picked, and the Jobs tab open. */
async function openJobs(page: Page, name: string, prompt: string) {
  const files = await uploadTiles(page, name.replace(/\W+/g, "-").toLowerCase(), 3);
  const { project } = (await (await page.request.post("/api/projects", { data: { name } })).json()) as {
    project: { id: string };
  };
  await stubModel(page);
  await page.route(`**/api/projects/${project.id}/jobs`, (route) =>
    route.fulfill({ json: { jobs: [jobFor(project.id, files, prompt)] } }),
  );
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Studio" });
  await nav.getByRole("button", { name: "Projects" }).click();
  await page.getByText(name, { exact: true }).first().click();
  await page.keyboard.press("Escape");

  // Pick the model after the project is open, so its references attach to the composer.
  await page.getByRole("button", { name: "Image → Video", exact: true }).click();
  await page.locator(".model-menu-trigger").first().click();
  const controls = page.waitForResponse((res) => res.url().endsWith(`/api/models/${MODEL.id}`));
  await page.getByRole("option", { name: /E2E Jobs/ }).click();
  await controls;

  await nav.getByRole("button", { name: "Projects" }).click();
  await page.getByRole("tab", { name: "Jobs" }).click();
  return page.getByRole("region", { name: "Jobs" });
}

test("an opened job shows when it ran, opens its references full size, and attaches references and outputs", async ({
  page,
}) => {
  const jobs = await openJobs(page, "Job details", "A quiet room with @Image1");

  const row = jobs.locator(".job-row").first();
  const ran = row.locator("time.job-ran");
  await expect(ran).toHaveText(/^(Today|Yesterday) \d{1,2}:\d{2} (am|pm)$/);
  await expect(ran).toHaveAttribute("title", /\d/);

  await row.getByRole("button", { name: /A quiet room/ }).click();
  await expect(row).toHaveClass(/is-open/);
  await expect(row.locator(".job-facts")).toContainText("Took");
  await expect(row.locator(".job-facts")).toContainText("42s");

  // Both prompt rows start closed.
  const folds = row.locator(".prompt-fold-toggle");
  await expect(folds).toHaveCount(2);
  await expect(folds.nth(0)).toContainText("Prompt");
  await expect(folds.nth(1)).toContainText("Sent to the model");
  await expect(folds.nth(0)).toHaveAttribute("aria-expanded", "false");
  await expect(folds.nth(1)).toHaveAttribute("aria-expanded", "false");
  await folds.nth(1).click();
  await expect(folds.nth(1)).toHaveAttribute("aria-expanded", "true");
  await expect(row.getByRole("button", { name: "Copy prompt" })).toBeVisible();

  // A reference opens full size, and the lightbox steps to the next one.
  await row.getByRole("button", { name: "Open Image 1, lead.png" }).click();
  const lightbox = page.getByRole("dialog", { name: "Image 1: lead.png" });
  await expect(lightbox).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: "Image 2: room.png" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".fullsize-backdrop")).toHaveCount(0);
  await expect(jobs).toBeVisible();

  // A file that is gone cannot be opened or attached.
  await expect(row.getByRole("button", { name: "Image 3 is gone" })).toBeDisabled();
  await expect(row.getByRole("button", { name: "Attach Image 3" })).toHaveCount(0);

  const chips = page.locator(".attach-chip");
  await expect(chips).toHaveCount(0);
  await row.getByRole("button", { name: "Attach Image 1" }).click();
  await expect(jobs.getByRole("status")).toHaveText("Added 1 file to the references.");
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toContainText("lead.png");

  // A finished output can be the next job's reference.
  await row.getByRole("button", { name: "Attach output 1" }).click();
  await expect(chips).toHaveCount(2);
});

test("a job with a very long prompt does not stretch the Jobs panel", async ({ page }) => {
  const long = "ANISSA walks in slowly from the entry and looks him up and down. ".repeat(95).slice(0, 6000);
  const jobs = await openJobs(page, "Long job prompt", long);
  const row = jobs.locator(".job-row").first();
  await row.getByRole("button", { name: /ANISSA walks in/ }).click();
  await expect(row.locator(".prompt-fold-toggle")).toHaveCount(2);

  const panel = page.getByRole("complementary", { name: "Projects" });
  const panelBox = (await panel.boundingBox())!;
  const rowBox = (await row.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(panelBox.x + panelBox.width, "panel ends on screen").toBeLessThanOrEqual(width);
  expect(rowBox.x + rowBox.width, "job ends inside the panel").toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
  const sideways = await jobs.evaluate((node: { scrollWidth: number; clientWidth: number }) => node.scrollWidth - node.clientWidth);
  expect(sideways, "nothing scrolls sideways").toBeLessThanOrEqual(1);
});
