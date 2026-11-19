import { describe, expect, it, vi } from "vitest";
import type { CollectionAsset, GallerySummary, StudioCollection } from "../src/lib/api";
import { assetAttachNote, assetDownloadName, downloadAssets } from "../src/lib/collection-assets";
import { collectionGalleries, galleryChoices, galleryPaneView, menuOpensUp } from "../src/lib/collection-view";
import { dropCandidates, galleryItemsForDrop } from "../src/lib/gallery-attach";

function collection(id: string, galleryIds: string[], position = 0): StudioCollection {
  return { id, name: id.toUpperCase(), position, updatedAt: 0, galleryIds, itemCount: 0, cover: null };
}

function gallery(id: string, collectionId: string | null = null): GallerySummary {
  return { id, name: `Gallery ${id}`, updatedAt: 0, collectionId };
}

function asset(key: string, overrides: Partial<CollectionAsset> = {}): CollectionAsset {
  return {
    key,
    kind: "image",
    name: `${key}.png`,
    role: "character",
    label: null,
    url: `https://studio.example/${key}`,
    thumbUrl: null,
    galleryId: "g1",
    galleryName: "Faces",
    galleryCount: 1,
    ...overrides,
  };
}

describe("what the Galleries pane shows", () => {
  it("shows an open gallery first, even one opened from a collection", () => {
    expect(galleryPaneView({ managingGallery: true, galleryId: "g1", collectionOpen: true })).toBe("gallery");
    expect(galleryPaneView({ managingGallery: true, galleryId: "g1", collectionOpen: false })).toBe("gallery");
  });

  it("goes back to the collection when the gallery's Back is pressed, and to the list without one", () => {
    expect(galleryPaneView({ managingGallery: false, galleryId: "g1", collectionOpen: true })).toBe("collection");
    expect(galleryPaneView({ managingGallery: false, galleryId: "g1", collectionOpen: false })).toBe("list");
  });

  it("does not show a gallery that is still loading", () => {
    expect(galleryPaneView({ managingGallery: true, galleryId: null, collectionOpen: true })).toBe("collection");
    expect(galleryPaneView({ managingGallery: true, galleryId: null, collectionOpen: false })).toBe("list");
  });
});

describe("an opened collection's galleries", () => {
  const collections = [collection("c1", ["g3", "g1"]), collection("c2", ["g2"], 1)];
  const summaries = [gallery("g1", "c1"), gallery("g2", "c2"), gallery("g3", "c1"), gallery("g4")];

  it("are the tiles in the collection's saved order, not the list order", () => {
    expect(collectionGalleries(collections, summaries, "c1").map((item) => item.id)).toEqual(["g3", "g1"]);
    expect(collectionGalleries(collections, summaries, "missing")).toEqual([]);
  });

  it("offer every other gallery to add, and say where one is filed now, since adding it moves it", () => {
    expect(galleryChoices(collections, summaries, "c1")).toEqual([
      { gallery: summaries[1], filedIn: "C2" },
      { gallery: summaries[3], filedIn: null },
    ]);
  });

  it("treat a gallery filed in an unknown collection as one that can be added", () => {
    const choices = galleryChoices(collections, [gallery("g5", "gone")], "c1");
    expect(choices).toEqual([{ gallery: expect.objectContaining({ id: "g5" }), filedIn: null }]);
  });
});

describe("a menu near the bottom of the panel", () => {
  const panel = { boundsTop: 0, boundsBottom: 800 };

  it("opens downward while it fits below its button", () => {
    expect(menuOpensUp({ ...panel, anchorTop: 100, anchorBottom: 130, menuHeight: 200 })).toBe(false);
  });

  it("opens upward on the last card, where it would run past the panel", () => {
    expect(menuOpensUp({ ...panel, anchorTop: 700, anchorBottom: 730, menuHeight: 200 })).toBe(true);
  });

  it("stays downward when there is even less room above", () => {
    expect(menuOpensUp({ boundsTop: 0, boundsBottom: 300, anchorTop: 60, anchorBottom: 90, menuHeight: 250 })).toBe(false);
  });
});

describe("an All assets tile dropped on the prompt", () => {
  const open = [{ id: "draft-1", name: "open.png" }];

  it("attaches the dragged asset, which the open gallery does not hold", () => {
    const dragged = { id: "u/1/a.png", name: "a.png" };
    expect(galleryItemsForDrop(dropCandidates(open, dragged), "u/1/a.png")).toEqual([dragged]);
  });

  it("still attaches an open gallery's own tile, and nothing for an unknown id", () => {
    const pool = dropCandidates(open, { id: "u/1/a.png", name: "a.png" });
    expect(galleryItemsForDrop(pool, "draft-1")).toEqual(open);
    expect(galleryItemsForDrop(pool, "nope")).toEqual([]);
    expect(dropCandidates(undefined, null)).toEqual([]);
  });
});

describe("All assets download and attach", () => {
  it("keeps the stored name, and adds an extension for its kind when it has none", () => {
    expect(assetDownloadName(asset("a", { name: "face.webp" }))).toBe("face.webp");
    expect(assetDownloadName(asset("a", { name: "clip", kind: "video" }))).toBe("clip.mp4");
    expect(assetDownloadName(asset("a", { name: "voice", kind: "audio" }))).toBe("voice.mp3");
    expect(assetDownloadName(asset("a", { name: "folder/still" }))).toBe("folder-still.png");
    expect(assetDownloadName(asset("a", { name: "  " }))).toBe("ds-studio-file.png");
  });

  it("downloads one file at a time in the order shown, skipping one with no link", async () => {
    const save = vi.fn(async () => {});
    await downloadAssets([asset("b"), asset("x", { url: "" }), asset("a")], save);
    expect(save.mock.calls).toEqual([
      ["https://studio.example/b", "b.png"],
      ["https://studio.example/a", "a.png"],
    ]);
  });

  it("says how many went on and how many the model could not take", () => {
    expect(assetAttachNote(3, 0)).toBe("Attached 3.");
    expect(assetAttachNote(3, 1)).toBe("Attached 2. Skipped 1.");
    expect(assetAttachNote(2, 2)).toBe("This model can’t take the selected media.");
    expect(assetAttachNote(0, 0)).toBe("Nothing to attach.");
  });
});
