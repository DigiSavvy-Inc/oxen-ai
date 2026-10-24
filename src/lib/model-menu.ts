export type NamedModel = {
  id: string;
  display_name?: string;
  description?: string | null;
};

export function modelLabel(model: NamedModel): string {
  return model.display_name || model.id;
}

export function filterModels<T extends NamedModel>(models: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return models;
  return models.filter((model) => {
    const haystack = [model.id, model.display_name ?? "", model.description ?? ""]
      .join("\n")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function groupPreferredModels<T extends { id: string }>(
  models: T[],
  preferred: T[],
): { preferred: T[]; rest: T[] } {
  const visible = new Map(models.map((model) => [model.id, model]));
  const preferredIds = new Set<string>();
  const ordered: T[] = [];
  for (const item of preferred) {
    const match = visible.get(item.id);
    if (!match || preferredIds.has(item.id)) continue;
    preferredIds.add(item.id);
    ordered.push(match);
  }
  return {
    preferred: ordered,
    rest: models.filter((model) => !preferredIds.has(model.id)),
  };
}

/** Favorites follow the saved order. New stars keep their place at the end. */
export function orderFavorites<T extends { id: string }>(favorites: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...favorites].sort((a, b) => {
    const aRank = rank.has(a.id) ? (rank.get(a.id) as number) : Number.MAX_SAFE_INTEGER;
    const bRank = rank.has(b.id) ? (rank.get(b.id) as number) : Number.MAX_SAFE_INTEGER;
    return aRank - bRank;
  });
}

export function reorderIds(ids: string[], fromId: string, toId: string): string[] {
  const from = ids.indexOf(fromId);
  const to = ids.indexOf(toId);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  const [item] = next.splice(from, 1);
  if (!item) return ids;
  next.splice(to, 0, item);
  return next;
}

export const MAX_BATCH_MODELS = 4;

/** Include or drop a model in this run. The primary stays first. At least one model. */
export function toggleBatchModel(
  batch: string[],
  id: string,
  primary: string,
): { batch: string[]; primary: string } {
  const unique = [...new Set(batch.includes(primary) ? batch : [primary, ...batch])].filter(
    (item) => item.trim(),
  );
  const current = unique.includes(primary) ? unique : [primary, ...unique];
  if (current.includes(id)) {
    if (current.length === 1) return { batch: current, primary };
    const next = current.filter((item) => item !== id);
    const nextPrimary = id === primary ? (next[0] ?? primary) : primary;
    return {
      batch: [nextPrimary, ...next.filter((item) => item !== nextPrimary)],
      primary: nextPrimary,
    };
  }
  if (current.length >= MAX_BATCH_MODELS) return { batch: current, primary };
  return { batch: [...current, id], primary };
}

/** Mode defaults list every catalog model for that mode. A saved id stays selectable. */
export function defaultModelChoices<T extends { id: string }>(
  catalog: T[],
  preferred: { id: string }[],
  currentId: string | undefined,
): { preferred: T[]; rest: Array<T | { id: string }> } {
  const byId = new Map(catalog.map((model) => [model.id, model]));
  const preferredIds = new Set<string>();
  const starred: T[] = [];
  for (const item of preferred) {
    const match = byId.get(item.id);
    if (!match || preferredIds.has(item.id)) continue;
    preferredIds.add(item.id);
    starred.push(match);
  }
  const rest: Array<T | { id: string }> = catalog.filter((model) => !preferredIds.has(model.id));
  if (currentId && !catalog.some((model) => model.id === currentId)) {
    rest.push({ id: currentId });
  }
  return { preferred: starred, rest };
}

export function generationCountForModelChange(
  previousModel: string,
  nextModel: string,
  currentCount: number,
  presetCount?: number | null,
): number {
  if (previousModel && previousModel === nextModel) return currentCount;
  if (typeof presetCount === "number" && Number.isFinite(presetCount)) {
    return Math.min(4, Math.max(1, Math.round(presetCount)));
  }
  return 1;
}

export function pickModel(
  models: { id: string }[],
  favorites: { id: string }[],
  preferredId: string | undefined,
  previous: string,
  modeSelected: boolean,
): string {
  const ids = new Set(models.map((model) => model.id));
  if (!modeSelected) {
    return previous && ids.has(previous) ? previous : "";
  }
  if (preferredId && ids.has(preferredId)) return preferredId;
  if (previous && ids.has(previous)) return previous;
  return favorites.find((model) => ids.has(model.id))?.id ?? "";
}
