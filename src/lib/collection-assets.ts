import { GALLERY_MAX_ITEMS } from "../../worker/gallery-limits";
import { normalizeMediaRole } from "../../worker/schema";
import type { CollectionAsset, CollectionCover, LibraryMediaFilter } from "./api";
import { downloadMedia } from "./download";
import type { GalleryDraftItem } from "./gallery-draft";
import type { HistoryGalleryItem } from "./gallery-history";
import { gallerySwipeSlides, type GallerySwipeSlide } from "./gallery-slides";
import { deleteBatches, tallyDelete, type DeleteResult, type DeleteScope, type DeleteTally } from "./media-delete";
import type { SlotAddItem } from "./slot-add";

/** `POST /api/galleries/files/delete` takes at most this many keys. */
export const COLLECTION_DELETE_BATCH = GALLERY_MAX_ITEMS;

/** Sends one request of at most COLLECTION_DELETE_BATCH keys. Resolves with the reply, rejects on failure. */
export type DeleteFilesRequest = (keys: string[], scope: DeleteScope) => Promise<unknown>;

/** One tally for the whole delete, plus the keys that left Studio (only batches the route accepted). */
export type BatchedDelete = DeleteTally & { removedKeys: string[] };

/**
 * Deletes files in batches the route accepts, one request at a time, and adds the answers into
 * one tally. A failed batch is counted as failed, its keys stay out of `removedKeys`, and the next
 * batch still goes.
 */
export async function deleteFilesInBatches(
  keys: readonly string[],
  scope: DeleteScope,
  send: DeleteFilesRequest,
): Promise<BatchedDelete> {
  const results: DeleteResult[] = [];
  const removedKeys: string[] = [];
  for (const batch of deleteBatches(keys, COLLECTION_DELETE_BATCH)) {
    try {
      const reply = await send(batch, scope);
      results.push({ ok: true, count: batch.length, reply });
      removedKeys.push(...batch);
    } catch {
      results.push({ ok: false, count: batch.length });
    }
  }
  return { ...tallyDelete(scope, results), removedKeys };
}

/** A ticked file and its place in the filtered list, so ticks kept across pages stay in grid order. */
export type PickedAsset = { asset: CollectionAsset; order: number };

/** Where a tile sits in the whole filtered list, counting earlier pages. */
export function assetOrder(page: number, pageSize: number, index: number): number {
  return (Math.max(1, page) - 1) * Math.max(0, pageSize) + index;
}

/**
 * Ticks or unticks files. Ticks on other pages stay. With `on` left out, the entries are ticked
 * unless every one of them already is, in which case they are unticked.
 */
export function togglePickedAssets(
  picked: readonly PickedAsset[],
  entries: readonly PickedAsset[],
  on?: boolean,
): PickedAsset[] {
  const had = new Set(picked.map((entry) => entry.asset.key));
  const tick = on ?? !entries.every((entry) => had.has(entry.asset.key));
  const touched = new Set(entries.map((entry) => entry.asset.key));
  const rest = picked.filter((entry) => !touched.has(entry.asset.key));
  return tick ? [...rest, ...entries] : rest;
}

/** The ticked files across every page, in the order the grid shows them, not the order they were ticked. */
export function pickedInOrder(picked: readonly PickedAsset[]): CollectionAsset[] {
  return [...picked].sort((a, b) => a.order - b.order).map((entry) => entry.asset);
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

/** The file name a download is saved as: the stored name, with an extension for its kind if it has none. */
export function assetDownloadName(asset: Pick<CollectionAsset, "name" | "kind">): string {
  const base = asset.name.replace(/[\\/]+/g, "-").trim() || "ds-studio-file";
  if (/\.[a-z0-9]{2,5}$/i.test(base)) return base;
  const ext = asset.kind === "video" ? "mp4" : asset.kind === "audio" ? "mp3" : "png";
  return `${base}.${ext}`;
}

/** Downloads the files one at a time, in the order given. */
export async function downloadAssets(
  assets: readonly CollectionAsset[],
  save: (url: string, filename: string) => Promise<void> = downloadMedia,
): Promise<void> {
  for (const asset of assets) {
    if (asset.url) await save(asset.url, assetDownloadName(asset));
  }
}

/** What Attach says afterwards: how many went on, and how many the current model could not take. */
export function assetAttachNote(total: number, skipped: number): string {
  if (total <= 0) return "Nothing to attach.";
  if (skipped >= total) return "This model can’t take the selected media.";
  return skipped > 0 ? `Attached ${total - skipped}. Skipped ${skipped}.` : `Attached ${total}.`;
}

/**
 * Set as cover on a tile. Only images take it. "current" is the file already chosen as the cover,
 * so the tile shows it as the cover instead of offering it again.
 */
export function assetCoverState(
  asset: Pick<CollectionAsset, "key" | "kind">,
  cover: Pick<CollectionCover, "key" | "chosen"> | null | undefined,
): "set" | "current" | null {
  if (asset.kind !== "image") return null;
  return cover?.chosen && cover.key === asset.key ? "current" : "set";
}
