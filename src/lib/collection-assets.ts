import { GALLERY_MAX_ITEMS } from "../../worker/gallery-limits";
import { normalizeMediaRole } from "../../worker/schema";
import type { CollectionAsset, LibraryMediaFilter } from "./api";
import type { GalleryDraftItem } from "./gallery-draft";
import type { HistoryGalleryItem } from "./gallery-history";
import { gallerySwipeSlides, type GallerySwipeSlide } from "./gallery-slides";
import { deleteBatches, tallyDelete, type DeleteResult, type DeleteScope, type DeleteTally } from "./media-delete";
import type { SlotAddItem } from "./slot-add";

/** `POST /api/galleries/files/delete` takes at most this many keys. */
export const COLLECTION_DELETE_BATCH = GALLERY_MAX_ITEMS;

/** Sends one request of at most COLLECTION_DELETE_BATCH keys. Resolves with the reply, rejects on failure. */
export type DeleteFilesRequest = (keys: string[], scope: DeleteScope) => Promise<unknown>;

/**
 * Deletes files in batches the route accepts, one request at a time, and adds the answers into
 * one tally. A failed batch is counted as failed and the next batch still goes.
 */
export async function deleteFilesInBatches(
  keys: readonly string[],
  scope: DeleteScope,
  send: DeleteFilesRequest,
): Promise<DeleteTally> {
  const results: DeleteResult[] = [];
  for (const batch of deleteBatches(keys, COLLECTION_DELETE_BATCH)) {
    try {
      const reply = await send(batch, scope);
      results.push({ ok: true, count: batch.length, reply });
    } catch {
      results.push({ ok: false, count: batch.length });
    }
  }
  return tallyDelete(scope, results);
}

/** The ticked assets, in the order the grid shows them. */
export function pickedAssets(assets: readonly CollectionAsset[], picked: readonly string[]): CollectionAsset[] {
  const chosen = new Set(picked);
  return assets.filter((asset) => chosen.has(asset.key));
}

function assetPreview(asset: CollectionAsset): string {
  return asset.thumbUrl || asset.url;
}

/** What Attach takes. Keys stand in for ids, since an asset is one file across galleries. */
export function assetDraftItems(assets: readonly CollectionAsset[]): GalleryDraftItem[] {
  return assets.map((asset) => ({
    id: asset.key,
    kind: asset.kind,
    name: asset.name,
    preview: assetPreview(asset),
    key: asset.key,
    url: asset.url,
    ...(asset.kind === "audio" ? {} : { role: normalizeMediaRole(asset.role) }),
    ...(asset.label ? { label: asset.label } : {}),
  }));
}

/** What Add to gallery takes. */
export function assetGalleryItems(assets: readonly CollectionAsset[]): HistoryGalleryItem[] {
  return assets.map((asset) => ({
    id: asset.key,
    kind: asset.kind,
    name: asset.name,
    preview: assetPreview(asset),
    key: asset.key,
    url: asset.url,
  }));
}

/** What Add to slot takes. Roles and labels go along. */
export function assetSlotItems(assets: readonly CollectionAsset[]): SlotAddItem[] {
  return assets.map((asset) => ({
    key: asset.key,
    kind: asset.kind,
    name: asset.name,
    role: asset.kind === "audio" ? null : normalizeMediaRole(asset.role),
    label: asset.label,
  }));
}

/** Lightbox slides for the page, images and videos in grid order. Audio uses the small player. */
export function assetSlides(assets: readonly CollectionAsset[]): GallerySwipeSlide[] {
  return gallerySwipeSlides(
    assets.map((asset) => ({
      id: asset.key,
      kind: asset.kind,
      name: asset.name,
      url: asset.url,
      preview: asset.thumbUrl ?? undefined,
    })),
  );
}

export function assetPageCount(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(pageSize) || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

export function emptyAssetsMessage(media: LibraryMediaFilter): string {
  if (media === "image") return "No images in this collection.";
  if (media === "video") return "No videos in this collection.";
  if (media === "audio") return "No audio in this collection.";
  return "No files yet. Add files to this collection's galleries.";
}

/** The caption under a tile: the first gallery that holds the file, and how many more do. */
export function assetGalleryCaption(asset: Pick<CollectionAsset, "galleryName" | "galleryCount">): string {
  const more = Math.max(0, Math.floor(asset.galleryCount) - 1);
  return more > 0 ? `${asset.galleryName} +${more}` : asset.galleryName;
}
