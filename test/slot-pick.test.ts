import { describe, expect, it } from "vitest";
import {
  openAfterChange,
  pickAll,
  pickBlocked,
  pickCount,
  pickedFiles,
  pickRoom,
  SLOT_PICK_MAX,
  slotRowMeta,
  slotSource,
  togglePick,
  type PickItem,
} from "../src/lib/slot-pick";
import { SLOT_FILES_MAX } from "../worker/slots";

function item(n: number, extra: Partial<PickItem> = {}): PickItem {
  return { kind: "image", name: `g${n}.png`, key: `u/u1/g${n}.png`, role: "object", ...extra };
}

const gallery = Array.from({ length: 96 }, (_, i) => item(i));
const own = (n: number) => ({ galleryId: null, files: gallery.slice(0, n) });
const linked = { galleryId: "gal-1", files: gallery.slice(0, 20) };

describe("slot picking", () => {
  it("uses the same limit the Worker enforces", () => {
    expect(SLOT_PICK_MAX).toBe(SLOT_FILES_MAX);
  });

  it("counts own files against the 12, so only what fits can be ticked", () => {
    const slot = own(9);
    let picked = new Set<string>();
    for (const entry of gallery.slice(20, 30)) picked = togglePick(slot, picked, entry.key);
    expect(picked.size).toBe(3);
    expect(pickCount(slot, picked)).toEqual({ used: 12, max: 12 });
    expect(pickRoom(slot, picked)).toBe(0);
    expect(pickBlocked(slot, picked, gallery[40]!.key)).toBe("A slot holds 12 files.");
  });

  it("frees room when a tick is removed", () => {
    const slot = own(11);
    const one = togglePick(slot, new Set(), gallery[50]!.key);
    expect(pickBlocked(slot, one, gallery[51]!.key)).not.toBeNull();
    const none = togglePick(slot, one, gallery[50]!.key);
    expect(pickBlocked(slot, none, gallery[51]!.key)).toBeNull();
  });

  it("will not tick a file the slot already holds", () => {
    const slot = own(2);
    expect(pickBlocked(slot, new Set(), gallery[0]!.key)).toBe("Already in this slot.");
    expect(togglePick(slot, new Set(), gallery[0]!.key).size).toBe(0);
  });

  it("select all ticks in gallery order, skips files in the slot, and stops at the limit", () => {
    const slot = own(4);
    const picked = pickAll(slot, gallery, new Set());
    expect([...picked]).toEqual(gallery.slice(4, 12).map((entry) => entry.key));
  });

  it("adds picked files after the slot's own, in gallery order whatever the tick order", () => {
    const slot = own(1);
    let picked = new Set<string>();
    for (const n of [30, 5, 17]) picked = togglePick(slot, picked, gallery[n]!.key);
    const files = pickedFiles(slot, gallery, picked);
    expect(files.map((file) => file.key)).toEqual([0, 5, 17, 30].map((n) => gallery[n]!.key));
  });

  it("carries each item's role, and audio has none", () => {
    const items = [item(1, { role: "background" }), item(2, { role: "scene" }), item(3, { kind: "audio", role: "character" })];
    const files = pickedFiles(own(0), items, new Set(items.map((entry) => entry.key)));
    expect(files.map((file) => file.role)).toEqual(["background", "background", null]);
  });

  it("dedupes keys and drops a label that would clash with one in the slot", () => {
    const slot = { galleryId: null, files: [item(0, { label: "Maya" })] };
    const items = [item(0), item(1, { label: "maya" }), item(1, { label: "maya" }), item(2, { label: "Ben" })];
    const files = pickedFiles(slot, items, new Set(items.map((entry) => entry.key)));
    expect(files.map((file) => [file.key, file.label])).toEqual([
      [gallery[0]!.key, "Maya"],
      [gallery[1]!.key, null],
      [gallery[2]!.key, "Ben"],
    ]);
  });

  it("on a linked slot, picks replace the gallery's files instead of adding to them", () => {
    expect(pickRoom(linked, new Set())).toBe(12);
    expect(pickBlocked(linked, new Set(), gallery[0]!.key)).toBeNull();
    const picked = new Set([gallery[3]!.key, gallery[1]!.key]);
    expect(pickedFiles(linked, gallery, picked).map((file) => file.key)).toEqual([gallery[1]!.key, gallery[3]!.key]);
    expect(pickCount(linked, picked)).toEqual({ used: 2, max: 12 });
  });

  // The closed row is all a person sees of most slots, so it has to tell them apart.
  it("sums up a closed slot row", () => {
    expect(slotRowMeta({ ...own(1), note: "" })).toBe("1 file");
    expect(slotRowMeta({ ...own(4), note: "ignored" })).toBe("4 files");
    expect(slotRowMeta({ ...linked, note: "" })).toBe("Whole gallery · 20 files");
    expect(slotRowMeta({ ...own(0), note: "warm skin" })).toBe("Text");
    expect(slotRowMeta({ ...own(0), note: "  " })).toBe("Empty");
  });

  it("opens a slot that was just added, and nothing on first load", () => {
    expect(openAfterChange(null, ["a", "b"], null)).toBeNull();
    expect(openAfterChange(["a"], ["a", "b"], "a")).toBe("b");
    expect(openAfterChange([], ["a"], null)).toBe("a");
  });

  it("keeps the open slot through a reorder and closes it when it is deleted", () => {
    expect(openAfterChange(["a", "b"], ["b", "a"], "a")).toBe("a");
    expect(openAfterChange(["a", "b"], ["b"], "a")).toBeNull();
  });

  it("says where a slot's files come from, and names a text slot", () => {
    expect(slotSource({ ...linked, galleryName: "Cast", note: "" })).toBe("Whole gallery: Cast (20 items)");
    expect(slotSource({ ...own(3), galleryName: null, note: "" })).toBe("Own files: 3 of 12");
    expect(slotSource({ ...own(0), galleryName: null, note: "warm skin" })).toMatch(/^Text slot/);
    expect(slotSource({ ...own(0), galleryName: null, note: " " })).toMatch(/^Empty/);
  });
});
