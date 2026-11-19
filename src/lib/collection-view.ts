import type { GallerySummary, StudioCollection } from "./api";
import { groupGalleries } from "./collections";

/** The two tabs of an opened collection. */
export type CollectionTab = "galleries" | "assets";

export type GalleryPaneView = "list" | "collection" | "gallery";

/**
 * What the Galleries pane shows: an open gallery first, then an open collection that still
 * exists, then the list. A gallery opened from a collection keeps the collection as its way back.
 */
export function galleryPaneView(input: {
  managingGallery: boolean;
  galleryId: string | null;
  collectionOpen: boolean;
}): GalleryPaneView {
  if (input.managingGallery && input.galleryId) return "gallery";
  return input.collectionOpen ? "collection" : "list";
}

/** One collection's galleries, in its saved order, from the cards already on screen. */
export function collectionGalleries(
  collections: readonly StudioCollection[],
  summaries: readonly GallerySummary[],
  collectionId: string,
): GallerySummary[] {
  return groupGalleries(collections, summaries).sections.find((section) => section.collection.id === collectionId)
    ?.galleries ?? [];
}

export type GalleryChoice = {
  gallery: GallerySummary;
  /** The collection it is filed in now. Adding it here moves it. Null when ungrouped. */
  filedIn: string | null;
};

/** Add galleries: every gallery of the profile not already in this collection, in list order. */
export function galleryChoices(
  collections: readonly StudioCollection[],
  summaries: readonly GallerySummary[],
  collectionId: string,
): GalleryChoice[] {
  const names = new Map(collections.map((collection) => [collection.id, collection.name]));
  return summaries.flatMap((gallery) => {
    const home = gallery.collectionId ?? null;
    if (home === collectionId) return [];
    return [{ gallery, filedIn: home ? (names.get(home) ?? null) : null }];
  });
}

/**
 * Whether a small menu should open above its button: when it does not fit below, inside the
 * panel, and there is more room above than below.
 */
export function menuOpensUp(input: {
  anchorTop: number;
  anchorBottom: number;
  menuHeight: number;
  boundsTop: number;
  boundsBottom: number;
  gap?: number;
}): boolean {
  const gap = input.gap ?? 4;
  const below = input.boundsBottom - input.anchorBottom - gap;
  const above = input.anchorTop - input.boundsTop - gap;
  return input.menuHeight > below && above > below;
}
