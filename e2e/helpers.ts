import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES = join(import.meta.dirname, "fixtures");

export type Uploaded = { kind: "image"; name: string; key: string };

/** Upload `count` small images through the app's own upload route. Names are `${prefix}-1.png`… */
export async function uploadTiles(page: Page, prefix: string, count: number): Promise<Uploaded[]> {
  const out: Uploaded[] = [];
  for (let i = 1; i <= count; i++) {
    const name = `${prefix}-${i}.png`;
    const res = await page.request.post("/api/upload", {
      multipart: {
        file: { name, mimeType: "image/png", buffer: readFileSync(join(FIXTURES, `tile-${((i - 1) % 6) + 1}.png`)) },
        folder: "galleries",
      },
    });
    expect(res.ok(), `upload ${name}`).toBe(true);
    out.push({ kind: "image", name, key: (await res.json()).key });
  }
  return out;
}

export async function makeGallery(page: Page, name: string, items: Uploaded[]): Promise<string> {
  const res = await page.request.post("/api/galleries", { data: { name, items } });
  expect(res.ok(), `gallery ${name}`).toBe(true);
  return (await res.json()).gallery.id;
}

export async function makeSlot(page: Page, name: string, note = ""): Promise<string> {
  const res = await page.request.post("/api/slots", { data: { name, note } });
  expect(res.ok(), `slot ${name}`).toBe(true);
  return (await res.json()).slot.id;
}

type SlotState = { name: string; galleryId: string | null; files: { name: string }[] };

/** The slot as the server has it, to confirm a click really saved. */
export async function slotNamed(page: Page, name: string): Promise<SlotState> {
  const { slots } = (await (await page.request.get("/api/slots")).json()) as { slots: SlotState[] };
  const slot = slots.find((entry) => entry.name === name);
  expect(slot, `slot ${name} exists`).toBeTruthy();
  return slot!;
}

export function slotsPanel(page: Page) {
  return page.getByRole("complementary", { name: "Slots" });
}

export async function openSlots(page: Page) {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Studio" }).getByRole("button", { name: "Slots" }).click();
  const panel = slotsPanel(page);
  await expect(panel.getByRole("textbox", { name: "New slot name" })).toBeVisible();
  return panel;
}

/** The one-line row of a slot. Its name starts with the slot name, then the handle and count. */
export function slotRow(page: Page, name: string) {
  return slotsPanel(page).getByRole("button", { name: new RegExp(`^${name} @`) });
}

export function library(page: Page) {
  return page.getByRole("complementary").filter({ has: page.getByRole("button", { name: "Close library" }) });
}

export async function openLibrary(page: Page) {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Studio" }).getByRole("button", { name: "Library" }).click();
  const panel = library(page);
  await expect(panel.getByRole("button", { name: "Galleries", exact: true })).toBeVisible();
  return panel;
}
