import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollectionAssets, CollectionAssetsBar } from "../src/components/CollectionAssets";
import type { CollectionAsset, CollectionAssetsPage } from "../src/lib/api";
import {
  COLLECTION_DELETE_BATCH,
  assetDraftItems,
  assetGalleryCaption,
  assetGalleryItems,
  assetOrder,
  assetPageCount,
  assetSlides,
  assetSlotItems,
  deleteFilesInBatches,
  emptyAssetsMessage,
  pickedInOrder,
  togglePickedAssets,
  type PickedAsset,
} from "../src/lib/collection-assets";
import { deleteOutcome } from "../src/lib/media-delete";

function asset(key: string, overrides: Partial<CollectionAsset> = {}): CollectionAsset {
  return {
    key,
    kind: "image",
    name: `${key}.png`,
    role: "character",
    label: null,
    url: `https://studio.test/m/${key}`,
    thumbUrl: `https://studio.test/t/${key}`,
    galleryId: "g1",
    galleryName: "Maya",
    galleryCount: 1,
    ...overrides,
  };
}

function keys(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `u/1/k${index}`);
}

const noop = () => undefined;
const noticeAsync = async () => ({ kind: "error" as const, message: "" });

describe("collection asset deletes", () => {
  it("matches the files delete route's cap", () => {
    expect(COLLECTION_DELETE_BATCH).toBe(96);
  });

  it("sends more than 96 files as batches of 96, one request at a time", async () => {
    const sent: number[] = [];
    let active = 0;
    let most = 0;
    const tally = await deleteFilesInBatches(keys(200), "studio", async (batch) => {
      active += 1;
      most = Math.max(most, active);
      sent.push(batch.length);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return { ok: true };
    });
    expect(sent).toEqual([96, 96, 8]);
    expect(most).toBe(1);
    expect(tally.removed).toBe(200);
    expect(deleteOutcome(tally).text).toBe("Removed 200 items from Studio.");
  });

  it("adds every batch into one notice", async () => {
    const tally = await deleteFilesInBatches(keys(150), "everywhere", async (batch) => ({
      oxenDeleted: batch.length,
    }));
    expect(deleteOutcome(tally)).toEqual({ tone: "ok", text: "Deleted 150 items from Studio and Oxen." });
  });

  it("keeps going after a failed batch and reports the part that stayed", async () => {
    let call = 0;
    const tally = await deleteFilesInBatches(keys(100), "studio", async () => {
      call += 1;
      if (call === 1) throw new Error("boom");
      return { ok: true };
    });
    expect(call).toBe(2);
    expect(tally.failed).toBe(96);
    expect(tally.removed).toBe(4);
    const outcome = deleteOutcome(tally);
    expect(outcome.tone).toBe("warn");
    expect(outcome.text).toContain("Couldn’t delete 96 of 100.");
  });

  it("sends a repeated key once and sends nothing for an empty selection", async () => {
    const seen: string[][] = [];
    await deleteFilesInBatches(["a", "b", "a"], "studio", async (batch) => {
      seen.push(batch);
      return {};
    });
    expect(seen).toEqual([["a", "b"]]);
    const none = await deleteFilesInBatches([], "studio", async () => {
      throw new Error("should not send");
    });
    expect(none.requested).toBe(0);
  });

  it("passes the scope through so Delete everywhere reaches Oxen", async () => {
    const scopes: string[] = [];
    await deleteFilesInBatches(["a"], "everywhere", async (_batch, scope) => {
      scopes.push(scope);
      return {};
    });
    expect(scopes).toEqual(["everywhere"]);
  });
});

describe("collection asset helpers", () => {
  const page = [
    asset("a"),
    asset("b", { kind: "video", role: "background", thumbUrl: null }),
    asset("c", { kind: "audio", role: null, thumbUrl: null }),
  ];

  function entries(pageNumber: number, pageSize: number, list: CollectionAsset[]): PickedAsset[] {
    return list.map((item, index) => ({ asset: item, order: assetOrder(pageNumber, pageSize, index) }));
  }

  it("acts on ticks in the order the grid shows them, not the order they were ticked", () => {
    const [a, , c] = entries(1, 3, page);
    const picked = togglePickedAssets(togglePickedAssets([], [c]), [a]);
    expect(pickedInOrder(picked).map((item) => item.key)).toEqual(["a", "c"]);
    expect(pickedInOrder(togglePickedAssets(picked, [c])).map((item) => item.key)).toEqual(["a"]);
  });

  it("keeps ticks from earlier pages, so a selection over 96 files reaches the batched delete", async () => {
    const size = 96;
    const first = entries(1, size, keys(size).map((key) => asset(key)));
    const second = entries(2, size, keys(size * 2).slice(size).map((key) => asset(key)));
    // Tick page 2 first, then page 1: the delete still goes in grid order.
    let picked = togglePickedAssets([], second, true);
    picked = togglePickedAssets(picked, first, true);
    const chosen = pickedInOrder(picked).map((item) => item.key);
    expect(chosen).toEqual(keys(size * 2));
    const sent: number[] = [];
    const tally = await deleteFilesInBatches(chosen, "studio", async (batch) => {
      sent.push(batch.length);
      return {};
    });
    expect(sent).toEqual([96, 96]);
    expect(tally.removed).toBe(192);
  });

  it("Select page ticks only that page, and Clear page leaves the other pages ticked", () => {
    const one = entries(1, 2, [asset("a"), asset("b")]);
    const two = entries(2, 2, [asset("c"), asset("d")]);
    let picked = togglePickedAssets([], one, true);
    picked = togglePickedAssets(picked, two.slice(0, 1));
    picked = togglePickedAssets(picked, two, true);
    expect(pickedInOrder(picked).map((item) => item.key)).toEqual(["a", "b", "c", "d"]);
    picked = togglePickedAssets(picked, two, false);
    expect(pickedInOrder(picked).map((item) => item.key)).toEqual(["a", "b"]);
  });

  it("attaches with roles and labels, and audio carries no role", () => {
    const drafts = assetDraftItems([asset("a", { role: null, label: "Hair" }), page[2]]);
    expect(drafts[0]).toMatchObject({ id: "a", key: "a", role: "character", label: "Hair" });
    expect(drafts[1]).not.toHaveProperty("role");
    expect(drafts[1].preview).toBe(page[2].url);
  });

  it("adds to a gallery and a slot by stored key", () => {
    expect(assetGalleryItems([page[1]])[0]).toMatchObject({ id: "b", key: "b", kind: "video", preview: page[1].url });
    expect(assetSlotItems(page).map((item) => item.role)).toEqual(["character", "background", null]);
  });

  it("puts images and videos in the lightbox and leaves audio for the small player", () => {
    expect(assetSlides(page).map((slide) => [slide.id, slide.mediaType])).toEqual([
      ["a", "image"],
      ["b", "video"],
    ]);
  });

  it("counts pages and names the gallery a file came from", () => {
    expect(assetPageCount(0, 36)).toBe(1);
    expect(assetPageCount(73, 36)).toBe(3);
    expect(assetGalleryCaption({ galleryName: "Maya", galleryCount: 1 })).toBe("Maya");
    expect(assetGalleryCaption({ galleryName: "Maya", galleryCount: 3 })).toBe("Maya +2");
    expect(emptyAssetsMessage("audio")).toBe("No audio in this collection.");
  });
});

function renderAssets(initialPage?: CollectionAssetsPage) {
  return renderToStaticMarkup(
    createElement(CollectionAssets, {
      collectionId: "c1",
      initialPage,
      summaries: [],
      onOpenGallery: noop,
      onAttach: noop,
      onAddToGallery: noticeAsync,
      onCreateGallery: noticeAsync,
      slotChoices: [],
      onAddToSlot: async () => ({ kind: "error", message: "" }),
      onCreateSlot: async () => ({ kind: "error", message: "" }),
      onDeleteFiles: async () => ({}),
    }),
  );
}

describe("CollectionAssets markup", () => {
  const firstPage: CollectionAssetsPage = {
    assets: [
      asset("a", { galleryName: "Maya", galleryCount: 2 }),
      asset("b", { kind: "audio", role: null, name: "voice.mp3", galleryId: "g2", galleryName: "Voices" }),
    ],
    page: 1,
    pageSize: 2,
    total: 5,
    media: "",
  };

  it("shows the Blocks loader before the first page arrives", () => {
    const html = renderAssets();
    expect(html).toContain("Loading files…");
    expect(html).toContain("loader-mark");
  });

  it("draws the media filter with Select page beside it", () => {
    const html = renderAssets(firstPage);
    expect(html).toMatch(/role="radiogroup" aria-label="Media type"/);
    const filters = [...html.matchAll(/role="radio" aria-checked="(true|false)"[^>]*>([^<]+)</g)].map(
      (match) => [match[2], match[1]],
    );
    expect(filters).toEqual([
      ["All", "true"],
      ["Images", "false"],
      ["Videos", "false"],
      ["Audio", "false"],
    ]);
    expect(html).toContain(">Select page<");
  });

  it("draws tiles in the order the page lists them, each with a checkbox and its gallery", () => {
    const html = renderAssets(firstPage);
    expect(html.indexOf('data-asset-key="a"')).toBeLessThan(html.indexOf('data-asset-key="b"'));
    expect(html).toContain('aria-label="Select a.png"');
    expect(html).toContain('aria-label="Open gallery Maya"');
    expect(html).toContain(">Maya +1<");
    expect(html).toContain('aria-label="Open a.png"');
    expect(html).toContain('aria-label="Play voice.mp3"');
  });

  it("shows the role as a read-only icon, and none on audio", () => {
    const html = renderAssets(firstPage);
    expect(html).toContain('class="gallery-role-chip collection-asset-role is-character"');
    expect(html).toContain('aria-label="Role: Character"');
    expect(html).not.toContain("<select");
    expect(html.match(/collection-asset-role/g)).toHaveLength(1);
    expect(html).not.toMatch(/Feature|Set as cover|Remove from gallery|Label for/);
  });

  it("shows the pager only when there is more than one page, and no bar until something is ticked", () => {
    const html = renderAssets(firstPage);
    expect(html).toContain('aria-label="Asset pages"');
    expect(html).toContain('aria-label="Page 1 of 3"');
    expect(html).not.toContain("collection-assets-bar");
    const single = renderAssets({ ...firstPage, total: 2 });
    expect(single).not.toContain("Asset pages");
  });

  it("says plainly when a filter finds nothing", () => {
    const html = renderAssets({ assets: [], page: 1, pageSize: 36, total: 0, media: "video" });
    expect(html).toContain("No videos in this collection.");
    expect(html).not.toContain("Select page");
  });
});

describe("CollectionAssetsBar markup", () => {
  function renderBar(withOptional: boolean) {
    const items = assetGalleryItems([asset("a"), asset("b")]);
    return renderToStaticMarkup(
      createElement(CollectionAssetsBar, {
        count: 2,
        onDownload: withOptional ? noop : undefined,
        onAttach: withOptional ? noop : undefined,
        onClear: noop,
        galleryItems: items,
        summaries: [],
        onAddToGallery: noticeAsync,
        onCreateGallery: noticeAsync,
        slotItems: assetSlotItems([asset("a"), asset("b")]),
        slotChoices: [],
        onAddToSlot: async () => ({ kind: "error", message: "" }),
        onCreateSlot: async () => ({ kind: "error", message: "" }),
        onDelete: withOptional ? noop : undefined,
      }),
    );
  }

  it("has the past-work controls in their order, with Clear right after Attach", () => {
    const html = renderBar(true);
    const order = ["2 selected", ">Download<", ">Attach<", ">Clear<", ">Add to gallery<", ">Add to slot<", ">Delete<"];
    const at = order.map((text) => html.indexOf(text));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("opens Add to gallery and Add to slot downward, and Delete is the one menu", () => {
    const html = renderBar(true);
    expect(html).toContain('class="history-gallery-tools is-below"');
    expect(html).toContain('class="history-gallery-tools history-slot-tools is-below"');
    expect(html).toMatch(/aria-haspopup="menu"[^>]*aria-label="Delete the selected files"/);
  });

  it("leaves out Download, Attach, and Delete when no handler is given, and keeps Clear", () => {
    const html = renderBar(false);
    expect(html).not.toContain(">Download<");
    expect(html).not.toContain(">Attach<");
    expect(html).toContain(">Clear<");
    expect(html).not.toContain("Delete the selected files");
  });
});

describe("All assets styles", () => {
  const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
  const start = css.indexOf("/* Collections: the All assets view");

  it("sits in one block at the very end, with its phone rules right after it", () => {
    expect(start).toBeGreaterThan(0);
    const tail = css.slice(start);
    expect(css.slice(0, start)).not.toContain("collection-asset");
    const phone = tail.indexOf("@media (max-width: 860px)");
    expect(phone).toBeGreaterThan(0);
    expect(tail.slice(phone).trimEnd().endsWith("}")).toBe(true);
    expect(tail.match(/@media/g)).toHaveLength(1);
  });

  it("keeps the bar's menus on a phone screen and needs no hover", () => {
    const phone = css.slice(css.indexOf("@media (max-width: 860px)", start));
    expect(phone).toContain(".collection-assets-bar .history-gallery-tools {\n    position: static;");
    expect(phone).toContain("max-width: calc(100% - 24px)");
    expect(css.slice(start)).not.toMatch(/:hover[^{]*\{[^}]*(display|opacity|visibility)/);
  });
});
