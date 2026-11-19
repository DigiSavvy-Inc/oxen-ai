import { expect, test, type Locator, type Page } from "@playwright/test";
import { library, makeCollection, makeGallery, makeSlot, slotRow, slotsPanel, uploadTiles } from "./helpers.ts";

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

// Drag is a desktop convenience. On a phone, filing a gallery goes through its menu, and the
// menu has to stay on a 390px screen without pushing the library sideways.
test("on a narrow phone a gallery is filed into a collection from its menu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await makeGallery(page, "PocketSet", await uploadTiles(page, "pocket", 2));
  await page.reload();
  await openFromMenu(page, "Library");
  const panel = library(page);
  await panel.getByRole("button", { name: "Galleries", exact: true }).click();

  await panel.getByRole("button", { name: "New collection", exact: true }).click();
  await panel.getByRole("textbox", { name: "New collection name" }).fill("PhoneShoot");
  await panel.getByRole("button", { name: "Create", exact: true }).click();
  const section = panel.getByRole("region", { name: "PhoneShoot" });
  await expect(section.getByText("No galleries yet. Drag one here.")).toBeVisible();

  const onScreen = async (locator: Locator) => {
    const box = (await locator.boundingBox())!;
    return box.x >= 0 && box.x + box.width <= 390;
  };

  await panel.getByRole("button", { name: "Move PocketSet to collection" }).click();
  const menu = page.getByRole("menu", { name: "Move PocketSet to collection" });
  await expect(menu).toBeVisible();
  expect(await onScreen(menu), "move menu is inside the screen").toBe(true);
  await menu.getByRole("menuitem", { name: /^PhoneShoot/ }).click();
  await expect(menu).toBeHidden();
  await expect(section.getByRole("button", { name: "PocketSet", exact: true })).toBeVisible();

  await section.getByRole("button", { name: "PhoneShoot options" }).click();
  const options = page.getByRole("menu", { name: "PhoneShoot options" });
  await expect(options.getByRole("menuitem", { name: "Rename" })).toBeVisible();
  await expect(options.getByRole("menuitem", { name: "Delete collection" })).toBeVisible();
  expect(await onScreen(options), "section menu is inside the screen").toBe(true);
  await page.keyboard.press("Escape");
  await expect(options).toBeHidden();

  await expectFullScreen(page, panel);
  expect(
    await panel.evaluate((root) =>
      [root, ...root.querySelectorAll("*")].filter((el) => el.scrollLeft !== 0).map((el) => el.className),
    ),
  ).toEqual([]);
});

// An opened collection on a 390px phone: full screen, the head on two rows with the tabs under
// it, every drag reachable from a tile's menu, and All assets with a bar that wraps.
test("on a narrow phone an opened collection fills the screen and works from menus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const top = await makeGallery(page, "PhoneTop", await uploadTiles(page, "phonetop", 2));
  const low = await makeGallery(page, "PhoneLow", await uploadTiles(page, "phonelow", 1));
  await makeCollection(page, "PhoneMaya", [top, low]);
  await page.reload();
  await openFromMenu(page, "Library");
  const panel = library(page);
  await panel.getByRole("button", { name: "Galleries", exact: true }).click();
  await panel.getByRole("button", { name: "Open PhoneMaya" }).click();

  const view = panel.getByLabel("Collection", { exact: true });
  const name = view.getByRole("textbox", { name: "Collection name" });
  await expect(name).toHaveValue("PhoneMaya");
  await expectFullScreen(page, panel);
  // The name takes its own row under the back button, and the tabs sit under the name.
  const back = (await view.getByRole("button", { name: "Galleries", exact: true }).boundingBox())!;
  const field = (await name.boundingBox())!;
  const tabs = (await view.getByRole("tablist", { name: "Collection view" }).boundingBox())!;
  expect(field.y).toBeGreaterThan(back.y + back.height - 1);
  expect(tabs.y).toBeGreaterThan(field.y + field.height - 1);

  const onScreen = async (locator: Locator) => {
    const box = (await locator.boundingBox())!;
    return box.x >= 0 && box.x + box.width <= 390;
  };
  await view.getByRole("button", { name: "Move PhoneTop to collection" }).click();
  const menu = page.getByRole("menu", { name: "Move PhoneTop to collection" });
  for (const item of ["Move up", "Move down", "Remove from collection"]) {
    await expect(menu.getByRole("menuitem", { name: item })).toBeVisible();
  }
  expect(await onScreen(menu), "tile menu is inside the screen").toBe(true);
  await menu.getByRole("menuitem", { name: "Move down" }).click();
  await expect(view.locator(".collection-tile .gallery-card-name")).toHaveText(["PhoneLow", "PhoneTop"]);

  await view.getByRole("button", { name: "Move PhoneLow to collection" }).click();
  await page
    .getByRole("menu", { name: "Move PhoneLow to collection" })
    .getByRole("menuitem", { name: "Remove from collection" })
    .click();
  await expect(view.locator(".collection-tile .gallery-card-name")).toHaveText(["PhoneTop"]);

  await view.getByRole("tab", { name: "All assets" }).click();
  const grid = view.getByLabel("All assets", { exact: true });
  await expect(grid.getByRole("checkbox", { name: /^Select / })).toHaveCount(2);
  await grid.getByRole("button", { name: "Select page" }).click();
  await expect(grid.getByText("2 selected")).toBeVisible();
  expect(await onScreen(grid.getByRole("button", { name: "Delete the selected files" }))).toBe(true);

  await expectFullScreen(page, panel);
  expect(
    await panel.evaluate((root) =>
      [root, ...root.querySelectorAll("*")].filter((el) => el.scrollLeft !== 0).map((el) => el.className),
    ),
  ).toEqual([]);
});

// Set as cover on a 390px touch phone: shown on the tile without hover, big enough to tap, and
// Reset cover in the head stays on screen.
test.describe("on a touch phone", () => {
  test.use({ hasTouch: true });

  test("Set as cover is tapped on an All assets tile, and Reset cover puts the automatic one back", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const gallery = await makeGallery(page, "PhoneCoverSet", await uploadTiles(page, "phonecover", 2));
    await makeCollection(page, "PhoneCover", [gallery]);
    const savedCover = async () => {
      const { collections } = (await (await page.request.get("/api/collections")).json()) as {
        collections: { name: string; cover: { key: string; chosen: boolean } | null }[];
      };
      return collections.find((entry) => entry.name === "PhoneCover")?.cover ?? null;
    };
    await page.reload();
    await openFromMenu(page, "Library");
    const panel = library(page);
    await panel.getByRole("button", { name: "Galleries", exact: true }).tap();
    await panel.getByRole("button", { name: "Open PhoneCover" }).tap();
    const view = panel.getByLabel("Collection", { exact: true });
    await view.getByRole("tab", { name: "All assets" }).tap();
    const grid = view.getByLabel("All assets", { exact: true });

    // No pointer has hovered the tile: the control is there and a finger-sized target.
    const set = grid.getByRole("button", { name: "Set phonecover-2.png as cover" });
    await expect(set).toBeVisible();
    const box = (await set.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(30);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await set.tap();
    await expect(grid.getByRole("img", { name: "Cover", exact: true })).toHaveCount(1);
    await expect.poll(savedCover).toMatchObject({ chosen: true });

    const reset = view.getByRole("button", { name: "Reset cover" });
    await expect(reset).toBeVisible();
    const resetBox = (await reset.boundingBox())!;
    expect(resetBox.x + resetBox.width).toBeLessThanOrEqual(390);
    await reset.tap();
    await expect(reset).toBeHidden();
    await expect.poll(savedCover).toMatchObject({ chosen: false });
    await expectFullScreen(page, panel);
  });
});
