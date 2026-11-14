import { expect, test } from "@playwright/test";
import { makeGallery, makeSlot, openLibrary, slotNamed, uploadTiles } from "./helpers.ts";

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
