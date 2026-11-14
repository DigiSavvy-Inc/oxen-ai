import { expect, test, type Locator, type Page } from "@playwright/test";
import { library, makeGallery, makeSlot, slotRow, slotsPanel, uploadTiles } from "./helpers.ts";

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

// The menu is wider than the space right of its button on a narrow phone. It used to hang
// past the right edge, and the browser then scrolled the whole library sideways to show it.
test("on a narrow phone the add-to-slot menu stays on screen and the library stays put", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await makeGallery(page, "PhoneSet", await uploadTiles(page, "phone", 13));
  await makeSlot(page, "PhoneSlot");
  await page.reload();
  await openFromMenu(page, "Library");
  const panel = library(page);
  await panel.getByRole("button", { name: "Galleries", exact: true }).click();
  await panel.getByRole("button", { name: "PhoneSet", exact: true }).click();
  const gallery = panel.getByLabel("Gallery", { exact: true });
  await gallery.getByRole("button", { name: "Select all" }).click();
  await gallery.getByRole("button", { name: "Add 13 to slot" }).click();

  const menu = page.getByRole("menu", { name: "Add 13 to slot" });
  await expect(menu).toBeVisible();
  const onScreen = async () => {
    const box = (await menu.boundingBox())!;
    return box.x >= 0 && box.x + box.width <= 390;
  };
  expect(await onScreen(), "menu is inside the screen when it opens").toBe(true);
  await expectFullScreen(page, panel);

  await menu.getByRole("menuitem", { name: /^PhoneSlot/ }).click();
  await expect(menu.getByRole("status")).toHaveText(
    "Added 12 files to PhoneSlot. 1 did not fit. A slot holds 12 files.",
  );
  expect(await onScreen(), "menu is inside the screen after a slot is picked").toBe(true);
  await expectFullScreen(page, panel);
  // Nothing inside the library is scrolled sideways either.
  expect(
    await panel.evaluate((root) =>
      [root, ...root.querySelectorAll("*")].filter((el) => el.scrollLeft !== 0).map((el) => el.className),
    ),
  ).toEqual([]);
});
