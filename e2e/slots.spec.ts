import { expect, test } from "@playwright/test";
import { makeGallery, makeSlot, openSlots, slotNamed, slotRow, uploadTiles } from "./helpers.ts";

test("slots are one-line rows, and only one is open at a time", async ({ page }) => {
  await page.goto("/");
  await makeSlot(page, "Alpha", "warm light, soft shadows");
  await makeSlot(page, "Bravo");
  const panel = await openSlots(page);

  const alpha = slotRow(page, "Alpha");
  const bravo = slotRow(page, "Bravo");
  // A note with no files is a text slot, not an empty one.
  await expect(alpha).toContainText("Text");
  await expect(bravo).toContainText("Empty");
  await expect(alpha).toHaveAttribute("aria-expanded", "false");
  await expect(bravo).toHaveAttribute("aria-expanded", "false");

  await alpha.click();
  await expect(alpha).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByText(/^Text slot/)).toBeVisible();

  await bravo.click();
  await expect(bravo).toHaveAttribute("aria-expanded", "true");
  await expect(alpha).toHaveAttribute("aria-expanded", "false");

  // A slot that was just added opens by itself, ready to fill.
  await panel.getByRole("textbox", { name: "New slot name" }).fill("Charlie");
  await panel.getByRole("button", { name: "Add", exact: true }).click();
  const charlie = slotRow(page, "Charlie");
  await expect(charlie).toHaveAttribute("aria-expanded", "true");
  await expect(charlie).toBeInViewport();
  await expect(bravo).toHaveAttribute("aria-expanded", "false");
});

test("the find box narrows a long list by name or handle", async ({ page }) => {
  await page.goto("/");
  for (let i = 1; i <= 7; i++) await makeSlot(page, `Finder${i}`);
  const panel = await openSlots(page);

  await panel.getByRole("searchbox", { name: "Find a slot" }).fill("@finder3");
  await expect(slotRow(page, "Finder3")).toBeVisible();
  await expect(slotRow(page, "Finder4")).toHaveCount(0);
  await panel.getByRole("searchbox", { name: "Find a slot" }).fill("no such slot");
  await expect(panel.getByText("No slot matches.")).toBeVisible();
});

test("a slot takes two images out of a larger gallery, or the whole gallery", async ({ page }) => {
  await page.goto("/");
  const galleryId = await makeGallery(page, "PickCast", await uploadTiles(page, "pick", 5));
  await makeSlot(page, "Picker");
  const panel = await openSlots(page);
  const row = slotRow(page, "Picker");
  await row.click();

  const picker = page.getByRole("region", { name: "Add from gallery to @Picker" });
  async function openGallery() {
    await panel.getByRole("button", { name: "Add from gallery" }).click();
    await picker.getByRole("button", { name: /^PickCast/ }).click();
  }

  // Two of five, in gallery order whatever order they were ticked in.
  await openGallery();
  await picker.getByRole("checkbox", { name: "Pick pick-4.png" }).check();
  await picker.getByRole("checkbox", { name: "Pick pick-2.png" }).check();
  await expect(picker.getByText(/^2 of 12/)).toBeVisible();
  await picker.getByRole("button", { name: "Add selected (2)" }).click();
  await expect(row).toContainText("2 files");
  await expect.poll(async () => (await slotNamed(page, "Picker")).files.map((file) => file.name)).toEqual([
    "pick-2.png",
    "pick-4.png",
  ]);

  // The whole gallery, as a link.
  await openGallery();
  await picker.getByRole("button", { name: "Use whole gallery" }).click();
  await expect(row).toContainText("Whole gallery · 5 files");
  await expect(panel.getByText("Whole gallery: PickCast (5 items)")).toBeVisible();
  await expect.poll(async () => (await slotNamed(page, "Picker")).galleryId).toBe(galleryId);

  // One click swaps the link for just the picked image. No dialog in the way.
  await openGallery();
  await picker.getByRole("checkbox", { name: "Pick pick-1.png" }).check();
  await picker.getByRole("button", { name: "Use only these (1)" }).click();
  await expect(row).toContainText("1 file");
  await expect.poll(async () => slotNamed(page, "Picker")).toMatchObject({
    galleryId: null,
    files: [{ name: "pick-1.png" }],
  });
});
