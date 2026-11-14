import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures");
const MODEL = {
  id: "e2e-frames-image-to-video",
  display_name: "E2E Frames",
  endpoint: "/videos/generate",
  capabilities: { input: ["text", "image"], output: ["video"] },
};

/**
 * The local Studio has no Oxen key, so the model list, its controls, and the
 * queue are answered here. Everything else is the real app.
 */
async function framesModel(page: Page, references: boolean) {
  const sent: Record<string, unknown>[] = [];
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
          mentions: false,
          pricing: null,
          slots: [
            { field: "input_image", kind: "image", required: !references, maxItems: 1, asArray: false },
            ...(references
              ? [{ field: "input_images", kind: "image", required: false, maxItems: 10, asArray: true }]
              : []),
          ],
          frames: { references, firstFace: true, lastFace: true },
        },
      },
    }),
  );
  await page.route("**/api/generate", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { generations: [] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Image → Video", exact: true }).click();
  await page.locator(".model-menu-trigger").first().click();
  await page.getByRole("option", { name: /E2E Frames/ }).click();
  return sent;
}

async function attach(page: Page, names: string[]) {
  await page.locator('input[type="file"]').first().setInputFiles(
    names.map((name, index) => ({
      name,
      mimeType: "image/png",
      buffer: readFileSync(join(FIXTURES, `tile-${index + 1}.png`)),
    })),
  );
}

function chips(page: Page) {
  return page.locator(".attach-chip");
}

test("two images on a frames model are the first and last frame, and dragging swaps them", async ({ page }) => {
  const sent = await framesModel(page, false);
  await attach(page, ["start.png", "end.png"]);

  await expect(chips(page)).toHaveCount(2);
  await expect(chips(page).nth(0)).toContainText("First frame");
  await expect(chips(page).nth(0)).toContainText("start.png");
  await expect(chips(page).nth(1)).toContainText("Last frame");
  await expect(page.getByText("Drag to swap first and last.")).toBeVisible();
  // Frames are not cited, so attaching them writes nothing into the prompt.
  await expect(page.getByRole("combobox", { name: /Describe the shot/ })).toHaveValue("");

  await chips(page).nth(1).dragTo(chips(page).nth(0), { targetPosition: { x: 4, y: 10 } });
  await expect(chips(page).nth(0)).toContainText("end.png");
  await expect(chips(page).nth(0)).toContainText("First frame");
  await expect(chips(page).nth(1)).toContainText("start.png");
  await expect(chips(page).nth(1)).toContainText("Last frame");

  await chips(page).nth(0).getByRole("checkbox", { name: "Real face" }).check();
  await page.getByRole("combobox", { name: /Describe the shot/ }).fill("she turns to the camera");
  await page.getByRole("button", { name: /^Generate/ }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].first_frame).toBeTruthy();
  expect(sent[0].last_frame).toBeTruthy();
  expect(sent[0].first_frame).not.toBe(sent[0].last_frame);
  expect(sent[0].first_frame_has_face).toBe(true);
  expect(sent[0].last_frame_has_face).toBeUndefined();
  expect(sent[0].images).toBeUndefined();
});

test("on a model that also takes references, an image is a reference until it is marked", async ({ page }) => {
  const sent = await framesModel(page, true);
  await attach(page, ["hero.png", "open.png", "close.png"]);

  await expect(chips(page)).toHaveCount(3);
  await expect(chips(page).nth(0)).toContainText("Image 1");
  await chips(page).nth(1).getByRole("combobox").selectOption("first");
  await chips(page).nth(2).getByRole("combobox").selectOption("last");
  await expect(chips(page).nth(1)).toContainText("First frame");
  await expect(chips(page).nth(2)).toContainText("Last frame");

  // Only one image can be the first frame.
  await chips(page).nth(0).getByRole("combobox").selectOption("first");
  await expect(chips(page).nth(0)).toContainText("First frame");
  await expect(chips(page).nth(1).locator(".attach-chip-token")).toHaveText("Image 2");

  await page.getByRole("combobox", { name: /Describe the shot/ }).fill("slow push in");
  await page.getByRole("button", { name: /^Generate/ }).click();
  await expect.poll(() => sent.length).toBe(1);
  expect(sent[0].first_frame).toBeTruthy();
  expect(sent[0].last_frame).toBeTruthy();
  expect(sent[0].images).toHaveLength(1);
});
