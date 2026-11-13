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
