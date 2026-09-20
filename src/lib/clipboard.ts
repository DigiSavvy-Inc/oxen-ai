export type ClipboardWriter = {
  writeText: (value: string) => Promise<void>;
};

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
