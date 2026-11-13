/** A gallery handle is the name people type after @. Image, Video, and Audio stay numbered mentions. */

export const GALLERY_HANDLE_MAX = 32;
export const GALLERY_LABEL_MAX = 24;
export const GALLERY_TAKE_MIN = 1;
export const GALLERY_TAKE_MAX = 4;

const HANDLE_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const LABEL_RE = /^[A-Za-z0-9]{1,24}$/;
/** `Image`, `Image1`, `Video2`, and `Audio` are already mention tokens. */
const RESERVED_HANDLE = /^(image|video|audio)\d*$/i;

export function reservedGalleryHandle(handle: string): boolean {
  return RESERVED_HANDLE.test(handle);
}

/** Gallery name with spaces removed, then only letters and numbers, starting with a letter. */
export function defaultGalleryHandle(name: string): string {
  const compact = name.replace(/\s+/g, "").replace(/[^A-Za-z0-9]/g, "");
  const handle = compact.replace(/^[0-9]+/, "").slice(0, GALLERY_HANDLE_MAX);
  if (!HANDLE_RE.test(handle) || reservedGalleryHandle(handle)) return "";
  return handle;
}

/** A stored handle, or null when it is blank, reserved, or not a single word. */
export function acceptGalleryHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const handle = raw.trim();
  if (!HANDLE_RE.test(handle) || reservedGalleryHandle(handle)) return null;
  return handle;
}

/** An item label, or null when the field is empty. Invalid text is rejected by the caller. */
export function acceptGalleryLabel(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const label = raw.trim();
  if (!label) return null;
  if (!LABEL_RE.test(label)) return null;
  return label;
}

export function galleryLabelInvalid(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw !== "string") return true;
  const label = raw.trim();
  if (!label) return false;
  return !LABEL_RE.test(label);
}

/** 1–4, or null when the value is missing or outside that range. */
export function acceptGalleryTake(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  if (raw < GALLERY_TAKE_MIN || raw > GALLERY_TAKE_MAX) return null;
  return raw;
}
