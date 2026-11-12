/**
 * Selection for an opened generation group. Any image can be ticked, the large one included.
 * Actions take the ticked images, or the image being shown when nothing is ticked.
 */

/** Ticks every id that is not ticked yet, or clears them when all of them already are. */
export function togglePicked(current: readonly string[], ids: readonly string[]): string[] {
  if (ids.length === 0) return [...current];
  const every = ids.every((id) => current.includes(id));
  if (every) return current.filter((id) => !ids.includes(id));
  const next = new Set(current);
  for (const id of ids) next.add(id);
  return [...next];
}

/** The ticked ids of one group, in the group's own order. */
export function pickedInGroup(groupIds: readonly string[], picked: readonly string[]): string[] {
  const ticked = new Set(picked);
  return groupIds.filter((id) => ticked.has(id));
}

export type ActionTargets = {
  ids: string[];
  /** False when nothing is ticked and the shown image stands in. */
  fromSelection: boolean;
};

export function actionTargets(
  groupIds: readonly string[],
  picked: readonly string[],
  shownId: string | null,
): ActionTargets {
  const ids = pickedInGroup(groupIds, picked);
  if (ids.length > 0) return { ids, fromSelection: true };
  return { ids: shownId && groupIds.includes(shownId) ? [shownId] : [], fromSelection: false };
}

/** True when every ticked item sits in this group, so the group's own bar is the one to use. */
export function selectionInsideGroup(groupIds: readonly string[], picked: readonly string[]): boolean {
  if (picked.length === 0) return false;
  const inside = new Set(groupIds);
  return picked.every((id) => inside.has(id));
}

/** "Delete" for the shown image, "Delete 2" for ticked ones. */
export function actionLabel(verb: string, targets: ActionTargets): string {
  return targets.fromSelection ? `${verb} ${targets.ids.length}` : verb;
}

export function addToGalleryLabel(targets: ActionTargets): string {
  return targets.fromSelection ? `Add ${targets.ids.length} to gallery` : "Add to gallery";
}

/** The line beside Select all: what the actions will take. */
export function selectionSummary(
  targets: ActionTargets,
  groupSize: number,
  kind: "image" | "video" | "audio" = "image",
): string {
  if (targets.fromSelection) return `${targets.ids.length} of ${groupSize} selected`;
  return kind === "image" ? "This image" : kind === "video" ? "This video" : "This clip";
}

/** Drops ticks for items that are no longer listed, such as ones just deleted. */
export function prunePicked(picked: readonly string[], liveIds: readonly string[]): string[] {
  const live = new Set(liveIds);
  return picked.filter((id) => live.has(id));
}
