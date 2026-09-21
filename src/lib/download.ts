import type { Generation } from "./api";

export function completedMedia(generations: Generation[]): Generation[] {
  return generations.filter((item) => item.status === "succeeded" && Boolean(item.resultUrl));
}

export function tilePreviewUrl(
  item: Pick<Generation, "mediaType" | "thumbUrl" | "resultUrl">,
): string | null {
  if (item.mediaType === "image") return item.thumbUrl || null;
  return item.thumbUrl || item.resultUrl || null;
}

export function canvasWashUrl(item: Pick<Generation, "thumbUrl">): string | null {
  return item.thumbUrl || null;
}

/** Stable 5-digit id derived from the generation row. The same asset always hashes to the same number. */
export function mediaAssetId(id: string): string {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return String((hash >>> 0) % 100_000).padStart(5, "0");
}

export function downloadFilename(generation: Pick<Generation, "id" | "mediaType" | "prompt">): string {
  const ext =
    generation.mediaType === "video" ? "mp4" : generation.mediaType === "audio" ? "mp3" : "png";
  const prompt = (generation.prompt || "media")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `ds-studio-${prompt || "media"}-${mediaAssetId(generation.id)}.${ext}`;
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
    ready.map((item) => downloadMedia(item.resultUrl ?? "", downloadFilename(item))),
  );
}
