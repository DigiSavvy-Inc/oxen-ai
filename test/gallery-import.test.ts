import { describe, expect, it } from "vitest";
import { GALLERY_MAX_ITEMS } from "../worker/gallery-limits";
import {
  appendGalleryUploads,
  galleryImportCandidate,
  galleryImportCreates,
  galleryImportNote,
  planGalleryImport,
} from "../src/lib/gallery-import";

function file(name: string, type: string): File {
  return new File(["x"], name, { type });
}

describe("gallery import", () => {
  it("accepts a mix of image, video, and audio in the order they were picked", () => {
    const files = [
      file("face.png", "image/png"),
      file("clip.mp4", "video/mp4"),
      file("voice.mp3", "audio/mpeg"),
    ];
    const plan = planGalleryImport(
      ["kept"],
      files.map((item) => galleryImportCandidate(item)),
      GALLERY_MAX_ITEMS,
    );
    expect(plan.take).toEqual([0, 1, 2]);
    expect(plan.added).toBe(3);
    expect(plan.skipped).toBe(0);
    expect(plan.leftOut).toBe(0);
    const next = appendGalleryUploads(
      [{ key: "kept" }],
      plan.take.map((index) => ({ key: `new-${index}` })),
      GALLERY_MAX_ITEMS,
    );
    expect(next.items.map((item) => item.key)).toEqual(["kept", "new-0", "new-1", "new-2"]);
  });

  it("counts a file that is not an image, a video, or audio as skipped", () => {
    const files = [file("face.png", "image/png"), file("notes.txt", "text/plain")];
    const plan = planGalleryImport(
      [],
      files.map((item) => galleryImportCandidate(item)),
      GALLERY_MAX_ITEMS,
    );
    expect(plan.take).toEqual([0]);
    expect(plan.skipped).toBe(1);
    expect(plan.added).toBe(1);
    expect(galleryImportNote(plan)).toBe("Skipped 1 file.");
  });

  it("leaves overflow out of a 96-item gallery and says how many", () => {
    const existing = Array.from({ length: GALLERY_MAX_ITEMS - 1 }, (_, index) => `k-${index}`);
    const plan = planGalleryImport(
      existing,
      [
        { kind: "image", key: null },
        { kind: "video", key: null },
        { kind: "audio", key: null },
      ],
      GALLERY_MAX_ITEMS,
    );
    expect(plan.take).toEqual([0]);
    expect(plan.added).toBe(1);
    expect(plan.leftOut).toBe(2);
    expect(galleryImportNote(plan)).toBe("Added 1. 2 did not fit.");

    const full = planGalleryImport(
      Array.from({ length: GALLERY_MAX_ITEMS }, (_, index) => `full-${index}`),
      [
        { kind: "image", key: null },
        { kind: "audio", key: null },
      ],
      GALLERY_MAX_ITEMS,
    );
    expect(full.take).toEqual([]);
    expect(full.added).toBe(0);
    expect(full.leftOut).toBe(2);
    expect(galleryImportNote(full)).toBe("Added 0. 2 did not fit.");
  });

  it("starts a new gallery from a pick, and a pick past 96 leaves the rest out", () => {
    expect(galleryImportCreates("")).toBe(true);
    expect(galleryImportCreates("  ")).toBe(true);
    expect(galleryImportCreates("new")).toBe(true);
    expect(galleryImportCreates("g-faces")).toBe(false);

    const mixed = planGalleryImport(
      [],
      [
        { kind: "image", key: null },
        { kind: "video", key: null },
        { kind: "audio", key: null },
        { kind: null, key: null },
      ],
      GALLERY_MAX_ITEMS,
    );
    expect(mixed.take).toEqual([0, 1, 2]);
    expect(mixed.skipped).toBe(1);

    const overflow = Array.from({ length: GALLERY_MAX_ITEMS + 3 }, () => ({
      kind: "image" as const,
      key: null,
    }));
    const plan = planGalleryImport([], overflow, GALLERY_MAX_ITEMS);
    expect(plan.added).toBe(GALLERY_MAX_ITEMS);
    expect(plan.leftOut).toBe(3);
    expect(plan.take).toHaveLength(GALLERY_MAX_ITEMS);
    expect(galleryImportNote(plan)).toBe(`Added ${GALLERY_MAX_ITEMS}. 3 did not fit.`);
  });

  it("does not duplicate an item already in the gallery, and does not remove it", () => {
    const current = [{ key: "shot", name: "keep" }];
    const plan = planGalleryImport(
      current.map((item) => item.key),
      [
        { kind: "image", key: "shot" },
        { kind: "video", key: null },
      ],
      GALLERY_MAX_ITEMS,
    );
    expect(plan.take).toEqual([1]);
    expect(plan.already).toBe(1);
    expect(plan.added).toBe(1);

    const only = appendGalleryUploads(current, [{ key: "shot", name: "copy" }], GALLERY_MAX_ITEMS);
    expect(only.items).toEqual([{ key: "shot", name: "keep" }]);
    expect(only.items[0]).toBe(current[0]);
    expect(only.added).toBe(0);
    expect(only.already).toBe(1);
    expect(galleryImportNote({ added: 0, leftOut: 0, skipped: 0, already: 1 })).toBe(
      "Already in this gallery",
    );

    const withNew = appendGalleryUploads(
      current,
      [
        { key: "shot", name: "copy" },
        { key: "fresh", name: "new" },
      ],
      GALLERY_MAX_ITEMS,
    );
    expect(withNew.items.map((item) => item.key)).toEqual(["shot", "fresh"]);
    expect(withNew.items[0]).toBe(current[0]);
  });
});
