import { mentionToken, slotMax, type Generation, type GenerationMode } from "./api";
import { downloadFilename } from "./download";
import type { MediaKind } from "./files";
import { DEFAULT_ATTACH_MAX, mediaKindCap, type CapControls } from "./kind-caps";

export { DEFAULT_ATTACH_MAX, mediaKindCap };

const MEDIA_KINDS: MediaKind[] = ["image", "video", "audio"];

type CatalogModel = { capabilities?: { input?: string[] } } | null | undefined;

/** True/false when the live catalog lists inputs. Null when the catalog is silent. */
export function catalogListsMediaKind(model: CatalogModel, kind: MediaKind): boolean | null {
  const inputs = model?.capabilities?.input;
  if (!inputs || inputs.length === 0) return null;
  return inputs.some((item) => item.toLowerCase() === kind);
}

export type LibraryRef = {
  generationId: string;
  name: string;
  preview: string;
  url: string;
  kind: Exclude<MediaKind, "document">;
};

export function kindFromMediaType(
  mediaType: string | null | undefined,
): Exclude<MediaKind, "document"> | null {
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

/**
 * How many files of this kind the selected model can take.
 * Schema slots win when they exist. A catalog that omits the kind blocks it.
 * A catalog that lists the kind opens a cap before the schema arrives.
 */
export function attachKindCap(
  controls: CapControls | null,
  mode: GenerationMode | null | undefined,
  kind: MediaKind,
  model?: CatalogModel,
): number {
  if (kind === "document") return mode === "chat" ? 4 : 0;
  const cap = mediaKindCap(controls, mode, kind);
  const listed = catalogListsMediaKind(model, kind);
  if (listed === false && slotMax(controls, kind) <= 0) return 0;
  if (listed === true && cap <= 0) {
    if (controls && controls.slots.length > 0) return 0;
    return DEFAULT_ATTACH_MAX;
  }
  return cap;
}

export function acceptedMediaKinds(
  controls: CapControls | null,
  mode: GenerationMode | null | undefined,
  model?: CatalogModel,
): MediaKind[] {
  if (mode === "chat") {
    return (["image", "document"] as const).filter(
      (kind) => attachKindCap(controls, mode, kind, model) > 0,
    );
  }
  return MEDIA_KINDS.filter((kind) => attachKindCap(controls, mode, kind, model) > 0);
}

export function fileAcceptValue(kinds: readonly MediaKind[]): string {
  return kinds
    .map((kind) => (kind === "document" ? "application/pdf,.pdf" : `${kind}/*`))
    .join(",");
}

export function mediaKindPhrase(kinds: readonly MediaKind[]): string {
  const words = kinds.map((kind) => {
    switch (kind) {
      case "image":
        return "images";
      case "video":
        return "videos";
      case "audio":
        return "audio";
      case "document":
        return "PDFs";
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  });
  if (words.length === 0) return "";
  if (words.length === 1) return words[0] ?? "";
  if (words.length === 2) return `${words[0]} or ${words[1]}`;
  return `${words[0]}, ${words[1]}, or ${words[2]}`;
}

export function supportedMediaNotice(kinds: readonly MediaKind[]): string {
  const phrase = mediaKindPhrase(kinds);
  if (!phrase) return "Choose a model that accepts this file.";
  return `This model accepts ${phrase}.`;
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
    if (existing.length >= cap) continue;
    next = [...others, ...existing, item];
  }
  return next;
}

export function appendAttachMention(
  prompt: string,
  kind: MediaKind,
  existingCount: number,
  addedCount: number,
): string {
  if (addedCount <= 0 || kind === "document") return prompt;
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
