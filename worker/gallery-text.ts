/** A gallery caption, for people. Not sent to the model. */
export const GALLERY_CAPTION_MAX = 500;
/** A note on one gallery item, for people. Not sent to the model. */
export const GALLERY_NOTE_MAX = 280;

/** C0 controls and DEL. A caption or a note is one line of text. */
export function stripGalleryControls(value: string): string {
  let out = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) continue;
    out += char;
  }
  return out;
}
