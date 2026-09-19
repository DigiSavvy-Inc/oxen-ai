import type { Generation } from "./api";
import { downloadFilename } from "./download";
import type { MediaKind } from "./files";

export type LibraryRef = {
  generationId: string;
  name: string;
  preview: string;
  url: string;
  kind: MediaKind;
};

export function kindFromMediaType(mediaType: string | null | undefined): MediaKind | null {
  if (mediaType === "image" || mediaType === "video" || mediaType === "audio") return mediaType;
  return null;
}

export function libraryRefFromGeneration(generation: Generation): LibraryRef | null {
  const kind = kindFromMediaType(generation.mediaType);
  if (!kind || generation.status !== "succeeded" || !generation.resultUrl) return null;
  return {
    generationId: generation.id,
    name: downloadFilename(generation),
    preview: generation.thumbUrl || generation.resultUrl,
    url: generation.resultUrl,
    kind,
  };
}

export function mergeLibraryRefs<T extends { kind: MediaKind; generationId?: string }>(
  prev: T[],
  incoming: T[],
  capForKind: (kind: MediaKind) => number,
): T[] {
  let next = [...prev];
  for (const item of incoming) {
    if (item.generationId && next.some((entry) => entry.generationId === item.generationId)) {
      continue;
    }
    const existing = next.filter((entry) => entry.kind === item.kind);
    const others = next.filter((entry) => entry.kind !== item.kind);
    next = [...others, ...[...existing, item].slice(0, capForKind(item.kind))];
  }
  return next;
}

export function releasePreview(preview: string) {
  if (preview.startsWith("blob:")) URL.revokeObjectURL(preview);
}
