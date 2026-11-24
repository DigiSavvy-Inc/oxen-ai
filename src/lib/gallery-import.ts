import { kindFromFile, type MediaKind } from "./files";

/** A gallery import takes images, video, and audio. Anything else is skipped. */
export type GalleryImportKind = "image" | "video" | "audio";

/** The list option that starts a gallery from the picked files. */
export const GALLERY_IMPORT_NEW = "new";

/** No gallery chosen, or New gallery: the pick creates one. */
export function galleryImportCreates(targetId: string | null | undefined): boolean {
  const id = targetId?.trim() ?? "";
  return id.length === 0 || id === GALLERY_IMPORT_NEW;
}

export type GalleryImportCandidate = {
  kind: MediaKind | null;
  /** Set when this is already a generation or upload. A new file has none. */
  key?: string | null;
};

export type GalleryImportPlan = {
  /** Indexes to add, in the order the files were picked. */
  take: number[];
  added: number;
  /** Media that did not fit in the gallery. */
  leftOut: number;
  /** Files that are not an image, a video, or audio. */
  skipped: number;
  /** The same generation or upload is already in the set. */
  already: number;
};

export function isGalleryImportKind(kind: MediaKind | null | undefined): kind is GalleryImportKind {
  return kind === "image" || kind === "video" || kind === "audio";
}

export function galleryImportCandidate(file: File, key?: string | null): GalleryImportCandidate {
  return { kind: kindFromFile(file), key: key ?? null };
}

function storedKey(key: string | null | undefined): string {
  return key?.trim() ?? "";
}

/**
 * Which picked files join the gallery. New files have no key, so each one is a new library
 * file. A key already in the set is left where it is and is not added again. Order is the
 * pick order, and the count stops at the gallery cap.
 */
export function planGalleryImport(
  existingKeys: readonly string[],
  candidates: readonly GalleryImportCandidate[],
  cap: number,
): GalleryImportPlan {
  const seen = new Set(existingKeys.map((key) => storedKey(key)).filter(Boolean));
  const take: number[] = [];
  let leftOut = 0;
  let skipped = 0;
  let already = 0;
  let count = existingKeys.length;
  candidates.forEach((candidate, index) => {
    if (!isGalleryImportKind(candidate.kind)) {
      skipped += 1;
      return;
    }
    const key = storedKey(candidate.key);
    if (key && seen.has(key)) {
      already += 1;
      return;
    }
    if (count >= cap) {
      leftOut += 1;
      return;
    }
    take.push(index);
    if (key) seen.add(key);
    count += 1;
  });
  return { take, added: take.length, leftOut, skipped, already };
}

export type GalleryImportAppend<T> = {
  items: T[];
  added: number;
  leftOut: number;
  already: number;
};

/** Append uploads after the items already in the gallery. An existing key stays and is not copied. */
export function appendGalleryUploads<T extends { key: string }>(
  current: readonly T[],
  incoming: readonly T[],
  cap: number,
): GalleryImportAppend<T> {
  const items = [...current];
  const seen = new Set(current.map((item) => storedKey(item.key)).filter(Boolean));
  let added = 0;
  let leftOut = 0;
  let already = 0;
  for (const item of incoming) {
    const key = storedKey(item.key);
    if (key && seen.has(key)) {
      already += 1;
      continue;
    }
    if (items.length >= cap) {
      leftOut += 1;
      continue;
    }
    items.push(item);
    if (key) seen.add(key);
    added += 1;
  }
  return { items, added, leftOut, already };
}

/** What to say when a pick did not all land. A clean add says nothing. */
export function galleryImportNote(report: {
  added: number;
  leftOut: number;
  skipped: number;
  already: number;
}): string | null {
  const parts: string[] = [];
  if (report.leftOut > 0) {
    parts.push(`Added ${report.added}.`);
    parts.push(`${report.leftOut} did not fit.`);
  }
  if (report.skipped > 0) {
    parts.push(report.skipped === 1 ? "Skipped 1 file." : `Skipped ${report.skipped} files.`);
  }
  if (parts.length > 0) return parts.join(" ");
  if (report.already > 0 && report.added === 0) return "Already in this gallery";
  return null;
}
