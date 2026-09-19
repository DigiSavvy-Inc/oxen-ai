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
  const preferredIds = new Set(preferred.map((model) => model.id));
  return {
    preferred: models.filter((model) => preferredIds.has(model.id)),
    rest: models.filter((model) => !preferredIds.has(model.id)),
  };
}

export function generationCountForModelChange(
  previousModel: string,
  nextModel: string,
  currentCount: number,
): number {
  if (!previousModel || previousModel === nextModel) return currentCount;
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
