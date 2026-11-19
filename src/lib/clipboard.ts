import { promptTextForCopy } from "./reference-roles";

export type ClipboardWriter = {
  writeText: (value: string) => Promise<void>;
};

type PromptCopyEvent = {
  currentTarget: EventTarget | null;
  clipboardData: { setData: (format: string, data: string) => void } | null;
  preventDefault: () => void;
};

/** Text the user actually selected. A prompt field keeps its own selection. */
export function selectedPlainText(target: EventTarget | null): string {
  if (typeof HTMLTextAreaElement !== "undefined" && target instanceof HTMLTextAreaElement) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    return target.value.slice(start, end);
  }
  if (typeof HTMLInputElement !== "undefined" && target instanceof HTMLInputElement) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    return target.value.slice(start, end);
  }
  if (typeof document !== "undefined") return document.getSelection()?.toString() ?? "";
  return "";
}

/**
 * A copy of a prompt writes the user's words. Role lines stay in the field and in
 * the request; this only replaces the clipboard when the selection included one.
 */
export function copyPromptText(event: PromptCopyEvent): void {
  const selected = selectedPlainText(event.currentTarget);
  const cleaned = promptTextForCopy(selected);
  if (cleaned === selected) return;
  event.preventDefault();
  event.clipboardData?.setData("text/plain", cleaned);
}

export async function copyText(text: string, clipboard?: ClipboardWriter): Promise<boolean> {
  if (!text) return false;
  if (clipboard) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const PASTE_IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
};

/** The image formats a paste can attach, in the words shown to the user. */
export const PASTE_IMAGE_FORMATS = "PNG, JPEG, GIF, WebP, AVIF, or BMP";

type PasteSource = {
  files?: ArrayLike<File> | null;
  getData?: (format: string) => string;
};

/**
 * Images on the clipboard, ready to attach. A screenshot arrives as a nameless or generically
 * named file, so each one gets a name that tells pasted images apart on their chips.
 *
 * `text` is true when the clipboard also carries words. Office apps put a picture of the copied
 * text beside the text itself; the paste is then a text paste and the picture is ignored.
 */
export function pastedImages(
  data: PasteSource | null | undefined,
  stamp: number = Date.now(),
): { files: File[]; unsupported: number; text: boolean } {
  const text = Boolean(data?.getData?.("text/plain"));
  const files: File[] = [];
  let unsupported = 0;
  if (text) return { files, unsupported, text };
  for (const file of Array.from(data?.files ?? [])) {
    if (!file.type.startsWith("image/")) continue;
    const ext = PASTE_IMAGE_EXT[file.type];
    if (!ext) {
      unsupported += 1;
      continue;
    }
    const generic = !file.name || /^image\.[a-z0-9]+$/i.test(file.name);
    if (!generic) {
      files.push(file);
      continue;
    }
    const suffix = files.length > 0 ? `-${files.length + 1}` : "";
    files.push(new File([file], `pasted-${pasteClock(stamp)}${suffix}.${ext}`, { type: file.type }));
  }
  return { files, unsupported, text };
}

function pasteClock(stamp: number): string {
  const at = new Date(stamp);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${two(at.getHours())}${two(at.getMinutes())}${two(at.getSeconds())}`;
}
