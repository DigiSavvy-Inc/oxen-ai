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
  // Files attached before the model's controls arrive are treated as plain references, so wait.
  const controls = page.waitForResponse((res) => res.url().endsWith(`/api/models/${MODEL.id}`));
  await page.getByRole("option", { name: /E2E Frames/ }).click();
  await controls;
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
  // Frames sit in the Images section, counted against the two the model takes.
  const images = page.locator('.attach-section[aria-label="Images"]');
  await expect(images.locator(".attach-chip")).toHaveCount(2);
  await expect(images.locator(".attach-section-head")).toHaveText(/Images\s*2 of 2/);
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

test("a screenshot pasted into the prompt attaches like a dropped file, and pasted text stays text", async ({ page }) => {
  await framesModel(page, true);
  const prompt = page.getByRole("combobox", { name: /Describe the shot/ });
  await prompt.click();

  const paste = (file: { name: string; type: string; base64: string } | null, text: string) =>
    prompt.evaluate(
      (node, input) => {
        // The test project is typed for Node, so the two browser classes are named here.
        type Clip = { items: { add(file: File): void }; setData(format: string, value: string): void };
        const browser = globalThis as unknown as {
          DataTransfer: new () => Clip;
          ClipboardEvent: new (type: string, init: object) => Event;
        };
        const data = new browser.DataTransfer();
        if (input.file) {
          const bytes = Uint8Array.from(atob(input.file.base64), (char) => char.charCodeAt(0));
          data.items.add(new File([bytes], input.file.name, { type: input.file.type }));
        }
        if (input.text) data.setData("text/plain", input.text);
        const event = new browser.ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
        node.dispatchEvent(event);
        return event.defaultPrevented;
      },
      { file, text },
    );

  const png = readFileSync(join(FIXTURES, "tile-1.png")).toString("base64");
  // A screenshot arrives as a generic "image.png".
  expect(await paste({ name: "image.png", type: "image/png", base64: png }, "")).toBe(true);
  await expect(chips(page)).toHaveCount(1);
  await expect(chips(page).nth(0)).toContainText(/pasted-\d{6}\.png/);

  // A format Studio cannot store is refused in plain words and attaches nothing.
  expect(await paste({ name: "image.tiff", type: "image/tiff", base64: png }, "")).toBe(true);
  await expect(chips(page)).toHaveCount(1);
  await expect(page.locator(".error-banner")).toHaveText("A pasted image has to be PNG, JPEG, GIF, WebP, AVIF, or BMP.");

  // Words on the clipboard are a text paste: the browser handles it and nothing attaches.
  expect(await paste({ name: "image.png", type: "image/png", base64: png }, "golden hour")).toBe(false);
  await expect(chips(page)).toHaveCount(1);
});

test("a run that fails to start says why beside the result, even under a tall prompt", async ({ page }) => {
  await framesModel(page, true);
  await page.unroute("**/api/generate");
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/generate", async (route) => {
    await held;
    await route.fulfill({ status: 400, json: { error: "API error: 400 - the reference was blocked" } });
  });
  // A long prompt, as in a real shot list, pushes the composer's own banner below the screen.
  await page.getByRole("combobox", { name: /Describe the shot/ }).fill("line of the shot\n".repeat(60));
  await page.getByRole("button", { name: /^Generate/ }).click();

  const status = page.locator(".run-status");
  await expect(status.getByText("Sending your run…")).toBeVisible();
  release();
  const message = status.getByRole("alert");
  await expect(message).toContainText("API error: 400 - the reference was blocked");
  await expect(message).toBeInViewport();
  await expect(status.getByText("Sending your run…")).toBeHidden();

  // It stays until it is dismissed.
  await message.getByRole("button", { name: "Dismiss this message" }).click();
  await expect(status).toHaveCount(0);
});

test("in a project, starting a new job keeps the running one in view, and its result shows when it finishes", async ({ page }) => {
  const { project } = (await (await page.request.post("/api/projects", { data: { name: "Vignette" } })).json()) as {
    project: { id: string };
  };
  await framesModel(page, true);
  await page.getByRole("navigation", { name: "Studio" }).getByRole("button", { name: "Projects" }).click();
  await page.getByText("Vignette", { exact: true }).first().click();
  // Opening a project loads it in the background. Acting before its header shows races that load.
  await expect(page.locator("button.project-new-job:visible").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".model-menu-trigger").first()).toContainText(MODEL.display_name);

  const image = `data:image/png;base64,${readFileSync(join(FIXTURES, "tile-1.png")).toString("base64")}`;
  let done = false;
  const run = () => ({
    id: "run-1",
    batchId: "batch-1",
    status: done ? "succeeded" : "processing",
    mode: "reference-to-video",
    model: MODEL.id,
    mediaType: "image",
    prompt: "clip one",
    writtenPrompt: "clip one",
    resultUrl: done ? image : null,
    thumbUrl: null,
    tags: [],
    projectId: project.id,
    createdAt: 1795000000,
    updatedAt: done ? 1795000100 : 1795000000,
    errorMessage: null,
  });
  await page.unroute("**/api/generate");
  await page.route("**/api/generate", (route) => route.fulfill({ json: { generations: [run()] } }));
  await page.route("**/api/generations/run-1", (route) => route.fulfill({ json: { generation: run() } }));

  await page.getByRole("combobox", { name: /Describe the shot/ }).fill("clip one");
  await page.getByRole("button", { name: /^Generate/ }).click();
  const canvas = page.locator(".workspace");
  await expect(canvas.getByText("processing")).toBeVisible();

  // Lining up the next clip must not hide the one still rendering.
  // The progress view above keeps the header moving, so the click is sent straight to the button.
  await page.locator("button.project-new-job:visible").first().dispatchEvent("click");
  await expect(page.getByRole("combobox", { name: /Describe the shot/ })).toHaveValue("");
  await expect(canvas.getByText("processing")).toBeVisible();

  done = true;
  await expect(canvas.getByText("succeeded")).toBeVisible({ timeout: 10_000 });
  await expect(canvas.locator("img").first()).toBeVisible();
});

test("a run with a very long prompt stays on screen", async ({ page }) => {
  // The closed prompt row shows one unwrapped line. A real shot list is thousands of
  // characters, and that line once stretched the canvas and pushed the result off screen.
  const long = "ANISSA walks in slowly from the entry and looks him up and down. ".repeat(90);
  const now = Math.floor(Date.now() / 1000);
  const run = {
    id: "long-1",
    batchId: "batch-long",
    status: "processing",
    mode: "reference-to-video",
    model: MODEL.id,
    mediaType: "video",
    prompt: `@Image1 ${long}`,
    writtenPrompt: `@Maya ${long}`,
    resultUrl: null,
    thumbUrl: null,
    tags: [],
    createdAt: now - 60,
    updatedAt: now - 5,
    errorMessage: null,
  };
  await page.route(/\/api\/generations\?scope=active/, (route) => route.fulfill({ json: { generations: [run] } }));
  await page.route("**/api/generations/long-1", (route) => route.fulfill({ json: { generation: run } }));
  await page.goto("/");

  const frame = page.locator(".result-frame");
  await expect(frame.getByText("processing")).toBeInViewport();
  await expect(frame.getByRole("status")).toBeInViewport();
  const box = (await frame.boundingBox())!;
  const width = page.viewportSize()!.width;
  expect(box.x, "frame starts on screen").toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, "frame ends on screen").toBeLessThanOrEqual(width);
  await expect(page.getByRole("button", { name: /Sent to the model/ })).toBeInViewport();
});

test("a finished video plays by itself only in the tab that started the run", async ({ page, context }) => {
  const clip = `data:video/mp4;base64,${readFileSync(join(FIXTURES, "clip.mp4")).toString("base64")}`;
  const now = Math.floor(Date.now() / 1000);
  let done = false;
  const run = () => ({
    id: "vid-1",
    batchId: "batch-vid",
    status: done ? "succeeded" : "processing",
    mode: "reference-to-video",
    model: MODEL.id,
    mediaType: "video",
    prompt: "clip",
    writtenPrompt: "clip",
    resultUrl: done ? clip : null,
    thumbUrl: null,
    tags: [],
    createdAt: now - 30,
    updatedAt: done ? now : now - 30,
    errorMessage: null,
  });

  // A second tab that is only watching: it sees the same running job.
  const other = await context.newPage();
  for (const tab of [page, other]) {
    await tab.route(/\/api\/generations\?scope=active/, (route) => route.fulfill({ json: { generations: [run()] } }));
    await tab.route("**/api/generations/vid-1", (route) => route.fulfill({ json: { generation: run() } }));
  }
  await other.goto("/");
  await expect(other.locator(".result-frame").getByText("processing")).toBeVisible();

  // This tab starts the run.
  await framesModel(page, true);
  await page.unroute("**/api/generate");
  await page.route("**/api/generate", (route) => route.fulfill({ json: { generations: [run()] } }));
  await page.getByRole("combobox", { name: /Describe the shot/ }).fill("clip");
  await page.getByRole("button", { name: /^Generate/ }).click();
  await expect(page.locator(".result-frame").getByText("processing")).toBeVisible();

  done = true;
  const started = page.locator("video.result-preview");
  const watching = other.locator("video.result-preview");
  await expect(started).toBeVisible({ timeout: 10_000 });
  await expect(watching).toBeVisible({ timeout: 10_000 });
  expect(await started.evaluate((video: { autoplay: boolean }) => video.autoplay)).toBe(true);
  // The other tab shows the result with its controls, and stays quiet.
  expect(await watching.evaluate((video: { autoplay: boolean; paused: boolean }) => [video.autoplay, video.paused])).toEqual([
    false,
    true,
  ]);
});
