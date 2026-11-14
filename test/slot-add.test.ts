import { describe, expect, it } from "vitest";
import type { StudioSlot } from "../src/lib/api";
import { slotAddNoticeText, slotChoices, slotFilesFromItems, slotRowMark } from "../src/lib/slot-add";

function slot(id: string, projectId: string | null, gallery: string | null = null): StudioSlot {
  return {
    id,
    name: id,
    handle: id,
    take: 1,
    note: "",
    projectId,
    galleryId: gallery ? `g-${gallery}` : null,
    galleryName: gallery,
    files: [],
  };
}

describe("Add to slot", () => {
  it("lists the open project's slots, then Everywhere slots, and never another project's", () => {
    const slots = [slot("Maya", null), slot("Set", "p1"), slot("Other", "p2"), slot("Room", null, "Loft")];
    expect(slotChoices(slots, "p1")).toEqual([
      { id: "Set", name: "Set", disabledReason: null },
      { id: "Maya", name: "Maya", disabledReason: null },
      { id: "Room", name: "Room", disabledReason: "Uses Loft" },
    ]);
    expect(slotChoices(slots, null).map((choice) => choice.id)).toEqual(["Maya", "Room"]);
  });

  it("sends finished files once each in selection order, starting images as a character", () => {
    const files = slotFilesFromItems([
      { key: "u/1/b.png", kind: "image", name: "b.png" },
      { key: "", kind: "image", name: "uploading.png" },
      { key: "u/1/a.mp3", kind: "audio", name: "a.mp3", role: "character" },
      { key: "u/1/b.png", kind: "image", name: "b.png" },
      { key: "u/1/c.png", kind: "image", name: "c.png", role: "background", label: "wide" },
    ]);
    expect(files).toEqual([
      { key: "u/1/b.png", kind: "image", name: "b.png", role: "character", label: null },
      { key: "u/1/a.mp3", kind: "audio", name: "a.mp3", role: null, label: null },
      { key: "u/1/c.png", kind: "image", name: "c.png", role: "background", label: "wide" },
    ]);
  });

  it("says plainly how many went in and how many did not fit", () => {
    const base = { kind: "added" as const, name: "Maya" };
    expect(slotAddNoticeText({ ...base, added: 3, already: 0, full: 0 })).toBe("Added 3 files to Maya.");
    expect(slotAddNoticeText({ ...base, added: 2, already: 1, full: 3 })).toBe(
      "Added 2 files to Maya. 3 did not fit. A slot holds 12 files. 1 was already in.",
    );
    expect(slotAddNoticeText({ ...base, added: 0, already: 0, full: 2 })).toBe(
      "Nothing added. Maya is full. 2 did not fit. A slot holds 12 files.",
    );
    expect(slotAddNoticeText({ ...base, added: 0, already: 2, full: 0 })).toBe("Already in Maya.");
    expect(slotAddNoticeText({ ...base, added: 1, already: 0, full: 0, created: true })).toBe(
      "Created Maya with 1 file.",
    );
    expect(slotRowMark({ ...base, added: 2, already: 0, full: 1 })).toBe("Added 2");
    expect(slotRowMark({ ...base, added: 0, already: 0, full: 1 })).toBe("Full");
  });
});
