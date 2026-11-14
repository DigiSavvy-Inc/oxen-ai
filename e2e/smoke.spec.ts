import { expect, test } from "@playwright/test";
import { library } from "./helpers.ts";

test("a signed-in person lands on the composer", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Studio" });
  for (const name of ["Library", "New", "Projects", "Slots", "Settings"]) {
    await expect(nav.getByRole("button", { name })).toBeVisible();
  }
  await expect(page.getByRole("combobox", { name: /Describe the shot/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Generate/ })).toBeVisible();
});

test("the library opens and closes from the button and from the keyboard", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Studio" });
  const close = library(page).getByRole("button", { name: "Close library" });

  await nav.getByRole("button", { name: "Library" }).click();
  await expect(close).toBeVisible();
  // Past work that was seeded shows up as tiles.
  await expect(library(page).getByRole("checkbox", { name: "Select image" })).toHaveCount(3);
  await close.click();
  await expect(close).toBeHidden();

  await page.keyboard.press("ControlOrMeta+Shift+KeyL");
  await expect(close).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+KeyL");
  await expect(close).toBeHidden();
});

test("settings opens", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Studio" }).getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 2 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Oxen API key" })).toBeVisible();
});
