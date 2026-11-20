import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures");
const MODEL = {
  id: "e2e-sections-reference-to-video",
  display_name: "E2E Sections",
  endpoint: "/videos/generate",
  capabilities: { input: ["text", "image", "audio"], output: ["video"] },
};

/** A model that takes four images and three voices. The local Studio has no Oxen key, so it is answered here. */
async function sectionsModel(page: Page) {
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
            { field: "input_images", kind: "image", required: false, maxItems: 4, asArray: true },
            { field: "input_audios", kind: "audio", required: false, maxItems: 3, asArray: true },
          ],
        },
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Image → Video", exact: true }).click();
  await page.locator(".model-menu-trigger").first().click();
  const controls = page.waitForResponse((res) => res.url().endsWith(`/api/models/${MODEL.id}`));
  await page.getByRole("option", { name: /E2E Sections/ }).click();
  await controls;
}

/** Images and voices interleaved, the way a real shot gets built up. */
async function attachMixed(page: Page) {
  const tone = readFileSync(join(FIXTURES, "tone.mp3"));
  const tile = (n: number) => readFileSync(join(FIXTURES, `tile-${n}.png`));
  await page.locator('input[type="file"]').first().setInputFiles([
    { name: "alpha.png", mimeType: "image/png", buffer: tile(1) },
    { name: "voice-one.mp3", mimeType: "audio/mpeg", buffer: tone },
    { name: "beta.png", mimeType: "image/png", buffer: tile(2) },
    { name: "voice-two.mp3", mimeType: "audio/mpeg", buffer: tone },
    { name: "gamma.png", mimeType: "image/png", buffer: tile(3) },
  ]);
}

const section = (page: Page, label: string) => page.locator(`.attach-section[aria-label="${label}"]`);
const chipsIn = (page: Page, label: string) => section(page, label).locator(".attach-chip");

async function boxes(page: Page, label: string, edge: "x" | "width"): Promise<number[]> {
  const chips = chipsIn(page, label);
  const out: number[] = [];
  for (let i = 0; i < (await chips.count()); i++) {
    const box = await chips.nth(i).boundingBox();
    if (box) out.push(Math.round(box[edge]));
  }
  return out;
}

test("attached media is grouped by kind, in order, each counted against the model's limit", async ({ page }) => {
  await sectionsModel(page);
  await attachMixed(page);

  const sections = page.locator(".attach-section");
  await expect(sections).toHaveCount(2);
  await expect(sections.nth(0)).toHaveAttribute("aria-label", "Images");
  await expect(sections.nth(1)).toHaveAttribute("aria-label", "Audio");
  await expect(section(page, "Images").locator(".attach-section-head")).toHaveText(/Images\s*3 of 4/);
  await expect(section(page, "Audio").locator(".attach-section-head")).toHaveText(/Audio\s*2 of 3/);
  await expect(page.locator(".attach-section-note")).toHaveCount(0);

  await expect(chipsIn(page, "Images")).toHaveCount(3);
  await expect(chipsIn(page, "Audio")).toHaveCount(2);
  await expect(chipsIn(page, "Audio").nth(0).locator(".attach-chip-token")).toHaveText("Audio 1");
  await expect(chipsIn(page, "Audio").nth(0)).toContainText("voice-one.mp3");

  // Chips in a section share one width so rows line up.
  const widths = await boxes(page, "Images", "width");
  expect(new Set(widths).size).toBe(1);
});

test("dragging reorders inside a section and leaves the other kind's numbers alone", async ({ page }) => {
  await sectionsModel(page);
  await attachMixed(page);
  const images = chipsIn(page, "Images");
  const voices = chipsIn(page, "Audio");
  await expect(images).toHaveCount(3);

  // Last image to the front.
  await images.nth(2).dragTo(images.nth(0), { targetPosition: { x: 4, y: 10 } });
  await expect(images.nth(0)).toContainText("gamma.png");
  await expect(images.nth(0).locator(".attach-chip-token")).toHaveText("Image 1");
  await expect(images.nth(1)).toContainText("alpha.png");
  await expect(images.nth(1).locator(".attach-chip-token")).toHaveText("Image 2");
  await expect(images.nth(2)).toContainText("beta.png");
  await expect(images.nth(2).locator(".attach-chip-token")).toHaveText("Image 3");

  await expect(voices.nth(0)).toContainText("voice-one.mp3");
  await expect(voices.nth(0).locator(".attach-chip-token")).toHaveText("Audio 1");
  await expect(voices.nth(1)).toContainText("voice-two.mp3");
  await expect(voices.nth(1).locator(".attach-chip-token")).toHaveText("Audio 2");

  // A voice dropped on an image does not cross into the Images section.
  await voices.nth(1).dragTo(images.nth(0), { targetPosition: { x: 4, y: 10 } });
  await expect(images).toHaveCount(3);
  await expect(voices).toHaveCount(2);
  await expect(voices.nth(1)).toContainText("voice-two.mp3");
  await expect(images.nth(0)).toContainText("gamma.png");
});

test("on a phone each section is one column and nothing scrolls sideways", async ({ page }) => {
  await sectionsModel(page);
  await attachMixed(page);
  await expect(chipsIn(page, "Images")).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });

  const lefts = await boxes(page, "Images", "x");
  expect(new Set(lefts).size).toBe(1);
  // The test project is typed for Node, so the element shape is named here.
  type Scroller = { scrollWidth: number; clientWidth: number };
  const sideways = (node: Scroller) => node.scrollWidth - node.clientWidth;
  expect(await page.locator(".attach-preview").evaluate(sideways)).toBeLessThanOrEqual(0);
  expect(await page.locator("html").evaluate(sideways)).toBeLessThanOrEqual(0);
});
