import { expect, test, type Locator, type Page } from "@playwright/test";
import { library, makeSlot, slotRow, slotsPanel } from "./helpers.ts";

async function openFromMenu(page: Page, name: "Library" | "Slots") {
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: /^Library, projects/ }).getByRole("button", { name }).click();
}

/** On a phone a panel is the whole screen, not a drawer beside the page. */
async function expectFullScreen(page: Page, panel: Locator) {
  const view = page.viewportSize()!;
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      return box ? [Math.round(box.x), Math.round(box.width)] : null;
    })
    .toEqual([0, view.width]);
}

test("on a phone the library fills the screen and closes", async ({ page }) => {
  await page.goto("/");
  await openFromMenu(page, "Library");
  const panel = library(page);
  const close = panel.getByRole("button", { name: "Close library" });
  await expect(close).toBeVisible();
  await expectFullScreen(page, panel);
  await close.click();
  await expect(close).toBeHidden();
  await expect(page.getByRole("combobox", { name: /Describe the shot/ })).toBeVisible();
});

test("on a phone slots fill the screen, open, and close", async ({ page }) => {
  await page.goto("/");
  await makeSlot(page, "Pocket", "phone note");
  await page.reload();
  await openFromMenu(page, "Slots");
  const panel = slotsPanel(page);
  const close = panel.getByRole("button", { name: "Close slots" });
  await expect(close).toBeVisible();
  await expectFullScreen(page, panel);

  const row = slotRow(page, "Pocket");
  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByRole("button", { name: "Add from gallery" })).toBeVisible();

  await close.click();
  await expect(close).toBeHidden();
});
