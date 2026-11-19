import type { GallerySummary, StudioCollection } from "./api";
import { moveItem } from "./mentions";

/** A gallery card on its way to a collection. Its own type, so the prompt, an open gallery,
 * and library drops never take it. */
export const GALLERY_CARD_DRAG_TYPE = "application/x-oxen-gallery-card";

/** A collection header being dragged into a new place in the list. */
export const COLLECTION_DRAG_TYPE = "application/x-oxen-collection";

/** Which collections are folded, remembered per browser the way the panel place is. */
export const COLLECTION_FOLD_KEY = "ds-studio-collection-folds";

export type CollectionSection = {
  collection: StudioCollection;
  galleries: GallerySummary[];
};

export type GroupedGalleries = {
  sections: CollectionSection[];
  /** Galleries in no collection, in the order the list came in (most recently updated first). */
  ungrouped: GallerySummary[];
};

/**
 * Sorts the gallery cards already on screen into their collections. A card's `collectionId` says
 * where it lives; the collection's saved order says where it sits. A card the collection does not
 * list yet (just filed) goes last, and a card that names an unknown collection stays ungrouped.
 */
export function groupGalleries(
  collections: readonly StudioCollection[],
  summaries: readonly GallerySummary[],
): GroupedGalleries {
  const known = new Map(collections.map((collection) => [collection.id, collection]));
  const members = new Map<string, GallerySummary[]>();
  const ungrouped: GallerySummary[] = [];
  for (const gallery of summaries) {
    const id = gallery.collectionId ?? null;
    if (!id || !known.has(id)) {
      ungrouped.push(gallery);
      continue;
    }
    const list = members.get(id) ?? [];
    list.push(gallery);
    members.set(id, list);
  }
  const sections = [...collections]
    .sort((a, b) => a.position - b.position)
    .map((collection) => {
      const rank = new Map(collection.galleryIds.map((id, index) => [id, index]));
      const galleries = (members.get(collection.id) ?? [])
        .map((gallery, index) => ({ gallery, index }))
        .sort((a, b) => {
          const ra = rank.get(a.gallery.id) ?? Number.MAX_SAFE_INTEGER;
          const rb = rank.get(b.gallery.id) ?? Number.MAX_SAFE_INTEGER;
          return ra - rb || a.index - b.index;
        })
        .map((entry) => entry.gallery);
      return { collection, galleries };
    });
  return { sections, ungrouped };
}

/**
 * What on the gallery cards can change a collection's item count or cover: which galleries are
 * filed where, their counts, and their first preview (by name; signed links change on every read). A rename, or any change to an ungrouped
 * gallery, leaves it the same, so the collections list is not read again for those.
 */
export function collectionWatchKey(summaries: readonly GallerySummary[]): string {
  return summaries
    .filter((gallery) => gallery.collectionId)
    .map((gallery) => `${gallery.id}>${gallery.collectionId}:${gallery.count ?? 0}:${gallery.previews?.[0]?.name ?? ""}`)
    .sort()
    .join("|");
}

/** "4 galleries, 212 items". */
export function collectionCountLabel(galleries: number, items: number): string {
  return `${galleries} ${galleries === 1 ? "gallery" : "galleries"}, ${items} ${items === 1 ? "item" : "items"}`;
}

/** The card list after one gallery is filed into a collection, or taken out with null. */
export function withGalleryCollection(
  summaries: readonly GallerySummary[],
  galleryId: string,
  collectionId: string | null,
): GallerySummary[] {
  return summaries.map((gallery) => (gallery.id === galleryId ? { ...gallery, collectionId } : gallery));
}

/** The card list after a collection is deleted: its galleries become ungrouped, nothing else moves. */
export function ungroupCollection(summaries: readonly GallerySummary[], collectionId: string): GallerySummary[] {
  return summaries.map((gallery) =>
    gallery.collectionId === collectionId ? { ...gallery, collectionId: null } : gallery,
  );
}

/** Collection ids with one moved a step up (-1) or down (+1). Null when it is already at that end. */
export function stepCollection(ids: readonly string[], id: string, step: -1 | 1): string[] | null {
  const from = ids.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  return moveItem([...ids], from, to);
}

/** Collection ids after a dragged header lands on another header: it takes that header's place. */
export function dropCollection(ids: readonly string[], dragId: string, targetId: string): string[] | null {
  const from = ids.indexOf(dragId);
  const to = ids.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return null;
  return moveItem([...ids], from, to);
}

/** Ids of collections in screen order. */
export function collectionOrder(collections: readonly StudioCollection[]): string[] {
  return [...collections].sort((a, b) => a.position - b.position).map((collection) => collection.id);
}

/** Collections rewritten into the given id order, positions renumbered from 0. */
export function orderedCollections(collections: readonly StudioCollection[], ids: readonly string[]): StudioCollection[] {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const out: StudioCollection[] = [];
  for (const id of ids) {
    const collection = byId.get(id);
    if (!collection) continue;
    out.push({ ...collection, position: out.length });
    byId.delete(id);
  }
  for (const collection of collections) {
    if (byId.has(collection.id)) out.push({ ...collection, position: out.length });
  }
  return out;
}

/** Reads the folded ids from storage text. Anything unreadable means nothing is folded. */
export function parseFolded(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))];
  } catch {
    return [];
  }
}

/** Folds an open section, or opens a folded one. */
export function toggleFolded(folded: readonly string[], id: string): string[] {
  return folded.includes(id) ? folded.filter((item) => item !== id) : [...folded, id];
}

export function readFolded(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return parseFolded(window.localStorage.getItem(COLLECTION_FOLD_KEY));
  } catch {
    return [];
  }
}

export function storeFolded(folded: readonly string[]) {
  try {
    window.localStorage.setItem(COLLECTION_FOLD_KEY, JSON.stringify(folded));
  } catch {
    /* storage unavailable */
  }
}

export type CollectionDrop =
  | { kind: "file"; galleryId: string; collectionId: string | null }
  | { kind: "order"; dragId: string; targetId: string };

/**
 * What a drop on a section (target id) or on Ungrouped (null) does. A gallery card files the
 * gallery there; a section header only reorders when dropped on another section. Anything else,
 * such as library tiles or files, does nothing here.
 */
export function collectionDrop(read: (type: string) => string, target: string | null): CollectionDrop | null {
  const galleryId = read(GALLERY_CARD_DRAG_TYPE);
  if (galleryId) return { kind: "file", galleryId, collectionId: target };
  const dragId = read(COLLECTION_DRAG_TYPE);
  if (dragId && target && dragId !== target) return { kind: "order", dragId, targetId: target };
  return null;
}

/** Hands a drop to the screen's handlers: file the gallery, or move the section. */
export function applyCollectionDrop(
  action: CollectionDrop | null,
  handlers: {
    onFile: (galleryId: string, collectionId: string | null) => Promise<boolean>;
    onDropOn: (dragId: string, targetId: string) => void;
  },
) {
  if (!action) return;
  if (action.kind === "file") void handlers.onFile(action.galleryId, action.collectionId);
  else handlers.onDropOn(action.dragId, action.targetId);
}

export function dragOffers(types: ArrayLike<string> | readonly string[], type: string): boolean {
  return Array.from(types).includes(type);
}
