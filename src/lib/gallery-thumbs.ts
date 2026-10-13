/** Display edges for gallery slots. These are the file widths, not the 256px library thumb. */
export const GALLERY_THUMB_SLOTS = ["strip", "tile", "cover"] as const;
export type GalleryThumbSlot = (typeof GALLERY_THUMB_SLOTS)[number];

const SLOT_WIDTH: Record<GalleryThumbSlot, number> = {
  strip: 96,
  tile: 160,
  cover: 160,
};

const NON_IMAGE = /\.(mp4|webm|mov|m4v|mkv|mp3|wav|m4a|ogg|opus|flac|aac|pdf)$/i;

export function galleryThumbWidth(slot: GalleryThumbSlot): number {
  switch (slot) {
    case "strip":
    case "tile":
    case "cover":
      return SLOT_WIDTH[slot];
    default: {
      const _never: never = slot;
      return _never;
    }
  }
}

/** Image bytes we can paint in a gallery slot. Video and audio files are not thumbs. */
export function galleryPreviewIsImage(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("data:image/")) return true;
  if (url.startsWith("data:") || url.startsWith("blob:")) return false;
  const path = (url.split("?")[0] ?? url).toLowerCase();
  return !NON_IMAGE.test(path);
}

/**
 * Point a Studio media URL at a slot-sized derivative.
 * Attach and generate keep the unsized URL.
 */
export function gallerySlotSrc(url: string, slot: GalleryThumbSlot): string {
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return url;
  let parsed: URL;
  try {
    parsed = new URL(url, "https://studio.local");
  } catch {
    return url;
  }
  if (!parsed.pathname.startsWith("/api/media/")) return url;
  parsed.searchParams.set("w", String(galleryThumbWidth(slot)));
  if (url.startsWith("/")) return `${parsed.pathname}${parsed.search}`;
  if (url.startsWith("http://") || url.startsWith("https://")) return parsed.toString();
  return url;
}
