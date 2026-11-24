import { GALLERY_CAPTION_MAX, GALLERY_NOTE_MAX, stripGalleryControls } from "../../worker/gallery-text";

export type GalleryFindTarget = {
  name: string;
  caption?: string | null;
  items?: readonly { note?: string | null }[];
};

export type GalleryImageTarget = {
  name: string;
  label?: string | null;
  note?: string | null;
};

function needle(query: string): string {
  return query.trim().toLowerCase();
}

function has(value: string | null | undefined, query: string): boolean {
  return (value ?? "").toLowerCase().includes(query);
}

/** The gallery list search: name, caption, or any item note. */
export function galleryListMatch(gallery: GalleryFindTarget, query: string): boolean {
  const q = needle(query);
  if (!q) return true;
  if (has(gallery.name, q) || has(gallery.caption, q)) return true;
  return (gallery.items ?? []).some((item) => has(item.note, q));
}

/** The open gallery's image filter: the caption, or this image's name, label, or note. */
export function galleryImageMatch(
  item: GalleryImageTarget,
  caption: string | null | undefined,
  query: string,
): boolean {
  const q = needle(query);
  if (!q) return true;
  return has(caption, q) || has(item.name, q) || has(item.label, q) || has(item.note, q);
}

/** The same limits the worker enforces, so the panel can say why a save was refused. */
export function galleryTextError(kind: "caption" | "note", raw: string): string | null {
  const text = stripGalleryControls(raw).trim();
  const max = kind === "caption" ? GALLERY_CAPTION_MAX : GALLERY_NOTE_MAX;
  if (text.length <= max) return null;
  return kind === "caption"
    ? `A caption can be up to ${GALLERY_CAPTION_MAX} characters.`
    : `A note can be up to ${GALLERY_NOTE_MAX} characters.`;
}
