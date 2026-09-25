import { modeIsVideo, type GenerationMode } from "./api";
import type { MediaKind } from "./files";

export {
  preferredAspectRatio,
  resolveEnqueueAspectRatio,
  showGetLastFrame,
} from "../../worker/schema";

export function aspectCatalog(
  controls: { aspectRatios?: string[] | null } | null | undefined,
  mode: GenerationMode | null,
): string[] {
  if (controls?.aspectRatios && controls.aspectRatios.length > 0) {
    return controls.aspectRatios;
  }
  if (mode && modeIsVideo(mode)) return ["16:9", "9:16", "1:1"];
  return ["1:1", "16:9", "9:16", "4:3", "3:4"];
}

export function aspectSelectOptions(catalog: string[], current: string): string[] {
  if (!current || catalog.includes(current)) return catalog;
  return [current, ...catalog];
}

export function takeStagedOfKind<T extends { kind: MediaKind }>(
  items: T[],
  kind: MediaKind,
  cap: number,
): T[] {
  if (cap <= 0) return [];
  return items.filter((item) => item.kind === kind).slice(0, cap);
}
