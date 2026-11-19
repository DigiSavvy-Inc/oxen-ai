import { describe, expect, it } from "vitest";
import type { GallerySummary, StudioCollection } from "../src/lib/api";
import {
  COLLECTION_DRAG_TYPE,
  GALLERY_CARD_DRAG_TYPE,
  applyCollectionDrop,
  collectionCountLabel,
  collectionDrop,
  collectionWatchKey,
  collectionOrder,
  dragOffers,
  dropCollection,
  groupGalleries,
  orderedCollections,
  parseFolded,
  stepCollection,
  toggleFolded,
  ungroupCollection,
  withGalleryCollection,
} from "../src/lib/collections";
import { GALLERY_ITEM_DRAG_TYPE, isGalleryItemDrag } from "../src/lib/gallery-attach";
import { HISTORY_MEDIA_DRAG_TYPE, fileDragOffered, historyDragOffered } from "../src/lib/history-drag";

function gallery(id: string, collectionId: string | null = null): GallerySummary {
  return { id, name: id.toUpperCase(), updatedAt: 0, collectionId };
}

function collection(id: string, position: number, galleryIds: string[] = []): StudioCollection {
  return { id, name: id, position, updatedAt: 0, galleryIds, itemCount: 0, cover: null };
}

const ids = (list: GallerySummary[]) => list.map((item) => item.id);

describe("grouping gallery cards by collection", () => {
  it("puts each card under its collection in saved order, and the rest below in list order", () => {
    // The list comes most recently updated first; ungrouped cards must keep that order.
    const cards = [gallery("g4"), gallery("g1", "c1"), gallery("g5"), gallery("g2", "c1"), gallery("g3", "c2")];
    const grouped = groupGalleries([collection("c2", 1, ["g3"]), collection("c1", 0, ["g2", "g1"])], cards);
    expect(grouped.sections.map((section) => section.collection.id)).toEqual(["c1", "c2"]);
    expect(ids(grouped.sections[0].galleries)).toEqual(["g2", "g1"]);
    expect(ids(grouped.sections[1].galleries)).toEqual(["g3"]);
    expect(ids(grouped.ungrouped)).toEqual(["g4", "g5"]);
  });

  it("files a card the collection does not list yet at the end, as the server does", () => {
    const cards = [gallery("new", "c1"), gallery("a", "c1"), gallery("b", "c1")];
    const grouped = groupGalleries([collection("c1", 0, ["b", "a"])], cards);
    expect(ids(grouped.sections[0].galleries)).toEqual(["b", "a", "new"]);
  });

  it("keeps a card whose collection is unknown in Ungrouped instead of losing it", () => {
    const grouped = groupGalleries([], [gallery("a", "gone"), gallery("b")]);
    expect(grouped.sections).toEqual([]);
    expect(ids(grouped.ungrouped)).toEqual(["a", "b"]);
  });

  it("shows an empty collection as a section with no cards", () => {
    const grouped = groupGalleries([collection("c1", 0)], [gallery("a")]);
    expect(grouped.sections).toHaveLength(1);
    expect(grouped.sections[0].galleries).toEqual([]);
    expect(ids(grouped.ungrouped)).toEqual(["a"]);
  });
});

describe("collection counts", () => {
  it("reads as galleries then items, singular for one", () => {
    expect(collectionCountLabel(4, 212)).toBe("4 galleries, 212 items");
    expect(collectionCountLabel(1, 1)).toBe("1 gallery, 1 item");
    expect(collectionCountLabel(0, 0)).toBe("0 galleries, 0 items");
  });
});

describe("filing changes only where a gallery lives", () => {
  it("moves one card and leaves the others and the order alone", () => {
    const cards = [gallery("a"), gallery("b", "c1"), gallery("c")];
    expect(withGalleryCollection(cards, "a", "c2").map((item) => item.collectionId)).toEqual(["c2", "c1", null]);
    expect(withGalleryCollection(cards, "b", null).map((item) => item.collectionId)).toEqual([null, null, null]);
    expect(ids(withGalleryCollection(cards, "a", "c2"))).toEqual(["a", "b", "c"]);
  });

  it("ungroups every gallery of a deleted collection and deletes none", () => {
    const cards = [gallery("a", "c1"), gallery("b", "c2"), gallery("c", "c1")];
    const after = ungroupCollection(cards, "c1");
    expect(ids(after)).toEqual(["a", "b", "c"]);
    expect(after.map((item) => item.collectionId)).toEqual([null, "c2", null]);
  });
});

describe("collection order", () => {
  const order = ["a", "b", "c", "d"];

  it("moves one step up or down and stops at the ends", () => {
    expect(stepCollection(order, "b", -1)).toEqual(["b", "a", "c", "d"]);
    expect(stepCollection(order, "b", 1)).toEqual(["a", "c", "b", "d"]);
    expect(stepCollection(order, "a", -1)).toBeNull();
    expect(stepCollection(order, "d", 1)).toBeNull();
    expect(stepCollection(order, "x", 1)).toBeNull();
  });

  it("takes the place of the header it is dropped on", () => {
    expect(dropCollection(order, "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(dropCollection(order, "d", "a")).toEqual(["d", "a", "b", "c"]);
    expect(dropCollection(order, "b", "b")).toBeNull();
    expect(dropCollection(order, "x", "b")).toBeNull();
  });

  it("reads screen order from positions and renumbers after a move", () => {
    const list = [collection("b", 1), collection("a", 0), collection("c", 2)];
    expect(collectionOrder(list)).toEqual(["a", "b", "c"]);
    const moved = orderedCollections(list, ["c", "a", "b"]);
    expect(moved.map((item) => [item.id, item.position])).toEqual([
      ["c", 0],
      ["a", 1],
      ["b", 2],
    ]);
    // An id the order left out is kept at the end rather than dropped.
    expect(orderedCollections(list, ["b"]).map((item) => item.id)).toEqual(["b", "a", "c"]);
  });
});

describe("folded sections", () => {
  it("reads stored ids and treats anything unreadable as nothing folded", () => {
    expect(parseFolded(null)).toEqual([]);
    expect(parseFolded("not json")).toEqual([]);
    expect(parseFolded('{"a":1}')).toEqual([]);
    expect(parseFolded('["a", 3, "", "b", "a"]')).toEqual(["a", "b"]);
  });

  it("toggles one section and leaves the others as they are", () => {
    expect(toggleFolded(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleFolded(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("the gallery card drag", () => {
  it("has its own type, so prompt, open gallery, and library drops do not take it", () => {
    for (const type of [GALLERY_CARD_DRAG_TYPE, COLLECTION_DRAG_TYPE]) {
      expect(type).not.toBe(GALLERY_ITEM_DRAG_TYPE);
      expect(type).not.toBe(HISTORY_MEDIA_DRAG_TYPE);
      expect(type).not.toBe("Files");
      expect(type).not.toBe("text/plain");
    }
    expect(dragOffers([GALLERY_CARD_DRAG_TYPE], GALLERY_CARD_DRAG_TYPE)).toBe(true);
    expect(dragOffers([GALLERY_ITEM_DRAG_TYPE], GALLERY_CARD_DRAG_TYPE)).toBe(false);
  });
});

describe("dropping on a section or on Ungrouped", () => {
  const reader = (data: Record<string, string>) => (type: string) => data[type] ?? "";

  it("files a dragged gallery card into the section, or takes it out on Ungrouped", () => {
    const card = reader({ [GALLERY_CARD_DRAG_TYPE]: "g1" });
    expect(collectionDrop(card, "c1")).toEqual({ kind: "file", galleryId: "g1", collectionId: "c1" });
    expect(collectionDrop(card, null)).toEqual({ kind: "file", galleryId: "g1", collectionId: null });
  });

  it("moves a dragged section header to the section it lands on, and nowhere else", () => {
    const header = reader({ [COLLECTION_DRAG_TYPE]: "c2" });
    expect(collectionDrop(header, "c1")).toEqual({ kind: "order", dragId: "c2", targetId: "c1" });
    expect(collectionDrop(header, "c2")).toBeNull();
    expect(collectionDrop(header, null)).toBeNull();
  });

  it("ignores library tiles, gallery tiles, and files", () => {
    for (const type of [GALLERY_ITEM_DRAG_TYPE, HISTORY_MEDIA_DRAG_TYPE, "text/plain", "Files"]) {
      expect(collectionDrop(reader({ [type]: "x" }), "c1")).toBeNull();
    }
  });

  it("hands the drop to the screen's handlers", () => {
    const filed: unknown[] = [];
    const moved: unknown[] = [];
    const handlers = {
      onFile: async (...args: unknown[]) => {
        filed.push(args);
        return true;
      },
      onDropOn: (...args: unknown[]) => {
        moved.push(args);
      },
    };
    applyCollectionDrop({ kind: "file", galleryId: "g1", collectionId: null }, handlers);
    applyCollectionDrop({ kind: "order", dragId: "c2", targetId: "c1" }, handlers);
    applyCollectionDrop(null, handlers);
    expect(filed).toEqual([["g1", null]]);
    expect(moved).toEqual([["c2", "c1"]]);
  });

  it("is not picked up by the prompt or library drop checks", () => {
    expect(historyDragOffered([GALLERY_CARD_DRAG_TYPE])).toBe(false);
    expect(isGalleryItemDrag([GALLERY_CARD_DRAG_TYPE])).toBe(false);
    expect(fileDragOffered([GALLERY_CARD_DRAG_TYPE])).toBe(false);
  });
});

describe("when the collections list is read again", () => {
  let signed = 0;
  const card = (id: string, collectionId: string | null, count: number, preview = "a.png", name = id): GallerySummary => ({
    id,
    name,
    updatedAt: 0,
    count,
    collectionId,
    previews: [{ kind: "image", name: preview, thumbUrl: `https://studio.example/${(signed += 1)}` }],
  });

  it("does not change for a rename, fresh signed links, or an ungrouped gallery's edits", () => {
    const before = collectionWatchKey([card("g1", "c1", 2), card("g2", null, 1)]);
    expect(collectionWatchKey([card("g1", "c1", 2, "a.png", "Renamed"), card("g2", null, 7, "z.png")])).toBe(before);
    expect(collectionWatchKey([card("g2", null, 1), card("g1", "c1", 2)])).toBe(before);
  });

  it("changes when a filed gallery's count or cover changes, or a gallery is filed", () => {
    const before = collectionWatchKey([card("g1", "c1", 2), card("g2", null, 1)]);
    expect(collectionWatchKey([card("g1", "c1", 3), card("g2", null, 1)])).not.toBe(before);
    expect(collectionWatchKey([card("g1", "c1", 2, "b.png"), card("g2", null, 1)])).not.toBe(before);
    expect(collectionWatchKey([card("g1", "c1", 2), card("g2", "c1", 1)])).not.toBe(before);
    expect(collectionWatchKey([card("g2", null, 1)])).not.toBe(before);
  });
});
