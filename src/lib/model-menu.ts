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
