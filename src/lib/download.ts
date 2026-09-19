import type { Generation } from "./api";

export function completedMedia(generations: Generation[]): Generation[] {
  return generations.filter((item) => item.status === "succeeded" && Boolean(item.resultUrl));
}

export function downloadFilename(generation: Generation, index = 0): string {
  const ext =
    generation.mediaType === "video" ? "mp4" : generation.mediaType === "audio" ? "mp3" : "png";
  const prompt = (generation.prompt || "media")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = index > 0 ? `-${index + 1}` : "";
  return `ds-studio-${prompt || "media"}${suffix}.${ext}`;
}

function triggerDownload(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noreferrer";
  document.body.append(link);
  link.click();
  link.remove();
}

export async function downloadMedia(url: string, filename: string): Promise<void> {
  if (url.startsWith("data:")) {
    triggerDownload(url, filename);
    return;
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerDownload(objectUrl, filename);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    triggerDownload(url, filename);
  }
}

export async function downloadAllMedia(generations: Generation[]): Promise<void> {
  const ready = completedMedia(generations);
  await Promise.all(
    ready.map((item, index) => downloadMedia(item.resultUrl ?? "", downloadFilename(item, index))),
  );
}
