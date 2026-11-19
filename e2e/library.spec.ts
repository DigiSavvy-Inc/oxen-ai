import { expect, test } from "@playwright/test";
import { library, makeCollection, makeGallery, makeSlot, openLibrary, slotNamed, uploadTiles } from "./helpers.ts";

test("ticked library images go into a slot, once", async ({ page }) => {
  await page.goto("/");
  await makeSlot(page, "LibSlot");
  const panel = await openLibrary(page);

  const boxes = panel.getByRole("checkbox", { name: "Select image" });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await expect(panel.getByText("2 selected")).toBeVisible();
  await panel.getByRole("button", { name: "Add to slot" }).click();
  const menu = page.getByRole("menu", { name: "Add to slot" });
  await menu.getByRole("menuitem", { name: /^LibSlot/ }).click();
  await expect(menu.getByRole("status")).toHaveText("Added 2 files to LibSlot.");
  await expect.poll(async () => (await slotNamed(page, "LibSlot")).files.length).toBe(2);

  // The menu stays open, and a second click must not add the same files again.
  await menu.getByRole("menuitem", { name: /^LibSlot/ }).click();
  await expect(menu.getByRole("status")).toHaveText("Already in LibSlot.");
  expect((await slotNamed(page, "LibSlot")).files.length).toBe(2);

  await menu.getByRole("menuitem", { name: "New slot…" }).click();
  await menu.getByRole("textbox", { name: "Slot name" }).fill("FromLibrary");
  await menu.getByRole("button", { name: "Create" }).click();
  await expect(menu.getByRole("status")).toHaveText("Created FromLibrary with 2 files.");
  expect((await slotNamed(page, "FromLibrary")).files.length).toBe(2);
});

test("a gallery is filed into a collection from Move to collection, and taken out again", async ({ page }) => {
  await page.goto("/");
  const galleryId = await makeGallery(page, "FileMe", await uploadTiles(page, "file", 2));
  const panel = await openLibrary(page);
  await panel.getByRole("button", { name: "Galleries", exact: true }).click();

  await panel.getByRole("button", { name: "New collection", exact: true }).click();
  await panel.getByRole("textbox", { name: "New collection name" }).fill("Shoot70");
  await panel.getByRole("button", { name: "Create", exact: true }).click();
  const section = panel.getByRole("region", { name: "Shoot70" });
  await expect(section.getByText("No galleries yet. Drag one here.")).toBeVisible();
  await expect(panel.getByRole("heading", { name: "Ungrouped" })).toBeVisible();

  await panel.getByRole("button", { name: "Move FileMe to collection" }).click();
  const menu = page.getByRole("menu", { name: "Move FileMe to collection" });
  await menu.getByRole("menuitem", { name: /^Shoot70/ }).click();
  await expect(menu).toBeHidden();
  await expect(section.getByRole("button", { name: "FileMe", exact: true })).toBeVisible();
  await expect(section.getByText("1 gallery, 2 items")).toBeVisible();
  await expect
    .poll(async () => {
      const { galleries } = (await (await page.request.get("/api/galleries")).json()) as {
        galleries: { id: string; collectionId?: string | null; count?: number }[];
      };
      const filed = galleries.find((entry) => entry.id === galleryId);
      return [Boolean(filed?.collectionId), filed?.count];
    })
    .toEqual([true, 2]);

  // A folded section stays folded after a reload.
  await section.getByRole("button", { name: "Fold Shoot70" }).click();
  await expect(section.getByRole("button", { name: "FileMe", exact: true })).toBeHidden();
  // The library remembers it was open, so after a reload it is already showing; clicking Library
  // again would close it. Only the pane resets to past work.
  await page.reload();
  const reopened = library(page);
  const galleriesTab = reopened.getByRole("button", { name: "Galleries", exact: true });
  await expect(galleriesTab).toBeVisible();
  if (!(await reopened.getByRole("region", { name: "Shoot70" }).isVisible())) await galleriesTab.click();
  const again = reopened.getByRole("region", { name: "Shoot70" });
  await expect(again.getByRole("button", { name: "Show Shoot70" })).toBeVisible();
  await expect(again.getByRole("button", { name: "FileMe", exact: true })).toBeHidden();
  await again.getByRole("button", { name: "Show Shoot70" }).click();

  await reopened.getByRole("button", { name: "Move FileMe to collection" }).click();
  await page.getByRole("menu", { name: "Move FileMe to collection" }).getByRole("menuitem", { name: "No collection" }).click();
  await expect(again.getByText("No galleries yet. Drag one here.")).toBeVisible();
  await expect(again.getByRole("button", { name: "FileMe", exact: true })).toBeHidden();
  await expect(reopened.getByRole("button", { name: "FileMe", exact: true })).toBeVisible();
});

test("a collection opens from the list, a gallery opened in it leads back, and ⌘⇧G returns to it", async ({ page }) => {
  await page.goto("/");
  const first = await makeGallery(page, "OpenFirst", await uploadTiles(page, "openfirst", 2));
  const second = await makeGallery(page, "OpenSecond", await uploadTiles(page, "opensecond", 1));
  await makeCollection(page, "Maya74", [second, first]);
  const panel = await openLibrary(page);
  await panel.getByRole("button", { name: "Galleries", exact: true }).click();

  await panel.getByRole("button", { name: "Open Maya74" }).click();
  const view = panel.getByLabel("Collection", { exact: true });
  await expect(view.getByRole("textbox", { name: "Collection name" })).toHaveValue("Maya74");
  await expect(view.getByText("2 galleries, 3 items")).toBeVisible();
  await expect(view.getByRole("tab", { name: "Galleries" })).toHaveAttribute("aria-selected", "true");
  // Saved order, not the list's most-recent-first order.
  const names = view.locator(".collection-tile .gallery-card-name");
  await expect(names).toHaveText(["OpenSecond", "OpenFirst"]);

  // Move down from the tile's menu, and the order is saved.
  await view.getByRole("button", { name: "Move OpenSecond to collection" }).click();
  await page.getByRole("menu", { name: "Move OpenSecond to collection" }).getByRole("menuitem", { name: "Move down" }).click();
  await expect(names).toHaveText(["OpenFirst", "OpenSecond"]);
  await expect
    .poll(async () => {
      const { collections } = (await (await page.request.get("/api/collections")).json()) as {
        collections: { name: string; galleryIds: string[] }[];
      };
      return collections.find((entry) => entry.name === "Maya74")?.galleryIds;
    })
    .toEqual([first, second]);

  // A gallery opened here reads Galleries / Maya74 / the gallery, and Back returns to the collection.
  await view.getByRole("button", { name: "OpenSecond", exact: true }).click();
  const gallery = panel.getByLabel("Gallery", { exact: true });
  await expect(gallery.getByRole("textbox", { name: "Gallery name" })).toHaveValue("OpenSecond");
  await gallery.getByRole("button", { name: "Back to Maya74" }).click();
  await expect(view.getByRole("textbox", { name: "Collection name" })).toHaveValue("Maya74");

  // ⌘⇧G closes the panel and reopens it on what was open last: the collection.
  await page.keyboard.press("ControlOrMeta+Shift+KeyG");
  await expect(view).toBeHidden();
  await page.keyboard.press("ControlOrMeta+Shift+KeyG");
  await expect(library(page).getByLabel("Collection", { exact: true })).toBeVisible();

  // Back to Galleries shows the list again.
  await view.getByRole("button", { name: "Galleries", exact: true }).click();
  await expect(panel.getByRole("region", { name: "Maya74" })).toBeVisible();
});

test("All assets shows each file of a collection once, with the selection bar", async ({ page }) => {
  await page.goto("/");
  const shared = await uploadTiles(page, "shared74", 1);
  const one = await makeGallery(page, "AssetsOne", [...(await uploadTiles(page, "assetsone", 2)), ...shared]);
  const two = await makeGallery(page, "AssetsTwo", [...shared, ...(await uploadTiles(page, "assetstwo", 1))]);
  await makeCollection(page, "Assets74", [one, two]);
  const panel = await openLibrary(page);
  await panel.getByRole("button", { name: "Galleries", exact: true }).click();
  await panel.getByRole("region", { name: "Assets74" }).getByRole("button", { name: "Assets74 options" }).click();
  await page.getByRole("menu", { name: "Assets74 options" }).getByRole("menuitem", { name: "Open" }).click();

  const view = panel.getByLabel("Collection", { exact: true });
  await view.getByRole("tab", { name: "All assets" }).click();
  const grid = view.getByLabel("All assets", { exact: true });
  // The shared file sits in both galleries and shows once.
  await expect(grid.getByRole("checkbox", { name: /^Select / })).toHaveCount(4);
  await expect(grid.getByRole("checkbox", { name: "Select shared74-1.png" })).toHaveCount(1);

  await grid.getByRole("radio", { name: "Videos" }).click();
  await expect(grid.getByText("No videos in this collection.")).toBeVisible();
  await grid.getByRole("radio", { name: "All" }).click();

  await grid.getByRole("checkbox", { name: "Select assetsone-1.png" }).check();
  await grid.getByRole("checkbox", { name: "Select assetstwo-1.png" }).check();
  await expect(grid.getByText("2 selected")).toBeVisible();
  for (const name of ["Download", "Attach", "Clear", "Add to gallery", "Add to slot", "Delete the selected files"]) {
    await expect(grid.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await grid.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(grid.getByText("2 selected")).toBeHidden();

  // A caption opens the gallery that holds the file, and Back returns to the collection.
  await grid.getByRole("button", { name: "Open gallery AssetsTwo" }).click();
  await panel.getByLabel("Gallery", { exact: true }).getByRole("button", { name: "Back to Assets74" }).click();
  await expect(view).toBeVisible();
});

test("Set as cover on an All assets image changes the list cover, and Reset cover puts it back", async ({ page }) => {
  await page.goto("/");
  const gallery = await makeGallery(page, "CoverSet", await uploadTiles(page, "cover76", 2));
  await makeCollection(page, "Cover76", [gallery]);
  const savedCover = async () => {
    const { collections } = (await (await page.request.get("/api/collections")).json()) as {
      collections: { name: string; cover: { key: string; chosen: boolean } | null }[];
    };
    return collections.find((entry) => entry.name === "Cover76")?.cover ?? null;
  };
  const automatic = (await savedCover())!;
  expect(automatic.chosen).toBe(false);

  const panel = await openLibrary(page);
  await panel.getByRole("button", { name: "Galleries", exact: true }).click();
  const listCover = panel.getByRole("button", { name: "Open Cover76" }).locator("img");
  const before = await listCover.getAttribute("src");
  await panel.getByRole("button", { name: "Open Cover76" }).click();

  const view = panel.getByLabel("Collection", { exact: true });
  // The automatic cover is not a choice, so there is nothing to reset yet.
  await expect(view.getByRole("button", { name: "Reset cover" })).toBeHidden();
  await view.getByRole("tab", { name: "All assets" }).click();
  const grid = view.getByLabel("All assets", { exact: true });
  await grid.getByRole("button", { name: "Set cover76-2.png as cover" }).click();
  await expect(grid.getByRole("img", { name: "Cover", exact: true })).toHaveCount(1);
  await expect(grid.getByRole("button", { name: "Set cover76-2.png as cover" })).toHaveCount(0);
  await expect.poll(savedCover).toMatchObject({ chosen: true });
  const chosen = (await savedCover())!;
  expect(chosen.key).not.toBe(automatic.key);

  // The list shows the chosen file, and it is still the cover after a reload.
  await view.getByRole("button", { name: "Galleries", exact: true }).click();
  await expect.poll(() => listCover.getAttribute("src")).not.toBe(before);
  const picked = await listCover.getAttribute("src");
  // The library stays open across a reload, so clicking Library again would close it.
  await page.reload();
  const reopened = library(page);
  const galleriesTab = reopened.getByRole("button", { name: "Galleries", exact: true });
  await expect(galleriesTab).toBeVisible();
  const openCover = reopened.getByRole("button", { name: "Open Cover76" });
  if (!(await openCover.isVisible())) await galleriesTab.click();
  await openCover.click();
  const again = reopened.getByLabel("Collection", { exact: true });
  await again.getByRole("button", { name: "Reset cover" }).click();
  await expect(again.getByRole("button", { name: "Reset cover" })).toBeHidden();
  await expect.poll(savedCover).toEqual(expect.objectContaining({ key: automatic.key, chosen: false }));
  await again.getByRole("button", { name: "Galleries", exact: true }).click();
  await expect
    .poll(() => reopened.getByRole("button", { name: "Open Cover76" }).locator("img").getAttribute("src"))
    .not.toBe(picked);
});

test("a slot keeps what fits from an open gallery and says what did not", async ({ page }) => {
  await page.goto("/");
  await makeGallery(page, "BigSet", await uploadTiles(page, "big", 13));
  await makeSlot(page, "Twelve");
  const panel = await openLibrary(page);

  await panel.getByRole("button", { name: "Galleries", exact: true }).click();
  await panel.getByRole("button", { name: "BigSet", exact: true }).click();
  const gallery = panel.getByLabel("Gallery", { exact: true });
  await gallery.getByRole("button", { name: "Select all" }).click();
  await gallery.getByRole("button", { name: "Add 13 to slot" }).click();
  const menu = page.getByRole("menu", { name: "Add 13 to slot" });
  await menu.getByRole("menuitem", { name: /^Twelve/ }).click();
  await expect(menu.getByRole("status")).toHaveText(
    "Added 12 files to Twelve. 1 did not fit. A slot holds 12 files.",
  );
  expect((await slotNamed(page, "Twelve")).files.length).toBe(12);
});
