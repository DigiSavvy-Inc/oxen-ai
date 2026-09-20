import { mentionToken, slotMax, type Generation, type GenerationMode, type ModelControls } from "./api";
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

export function mediaKindCap(
  controls: Pick<ModelControls, "slots"> | null,
  mode: GenerationMode | null | undefined,
  kind: MediaKind,
): number {
  const fromSlots = slotMax(controls, kind);
  let modeFloor = 0;
  switch (kind) {
    case "image":
      modeFloor =
        mode === "image-to-image" || mode === "reference-to-video" || mode === "video-to-video"
          ? 1
          : 0;
      break;
    case "video":
      modeFloor = mode === "video-to-video" ? 1 : 0;
      break;
    case "audio":
      modeFloor = 0;
      break;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
  if (controls) return Math.max(fromSlots, modeFloor);
  if (modeFloor > 0) return modeFloor;
  if (!mode) return 1;
  return 0;
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
    const cap = capForKind(item.kind);
    if (cap <= 0) continue;
    const existing = next.filter((entry) => entry.kind === item.kind);
    const others = next.filter((entry) => entry.kind !== item.kind);
    next = [...others, ...[...existing, item].slice(-cap)];
  }
  return next;
}

export function appendAttachMention(
  prompt: string,
  kind: MediaKind,
  existingCount: number,
  addedCount: number,
): string {
  if (addedCount <= 0) return prompt;
  let next = prompt;
  for (let offset = 0; offset < addedCount; offset += 1) {
    const token = mentionToken(kind, existingCount + offset);
    if (!next.includes(token)) next = next.trim() ? `${next.trim()} ${token}` : token;
  }
  return next;
}

export function releasePreview(preview: string) {
  if (preview.startsWith("blob:")) URL.revokeObjectURL(preview);
}
