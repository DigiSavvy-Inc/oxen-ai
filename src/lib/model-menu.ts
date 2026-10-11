export type NamedModel = {
  id: string;
  display_name?: string;
  description?: string | null;
};

export function modelLabel(model: NamedModel): string {
  return model.display_name || model.id;
}

function searchTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .map((part) => part.replace(/^\.+|\.+$/g, ""))
    .filter(Boolean);
}

function tokensMatch(parts: string[], words: string[]): boolean {
  return words.every((word) => parts.some((part) => part.startsWith(word)));
}

function nameStartsWith(model: NamedModel, needle: string): boolean {
  if (modelLabel(model).toLowerCase().startsWith(needle)) return true;
  const tail = model.id.split("/").pop() ?? model.id;
  return tail.toLowerCase().startsWith(needle);
}

/**
 * A single letter matches the start of the model name.
 * Longer queries match the start of a word in the name or id.
 * Descriptions join in once the query is at least 3 characters.
 */
export function filterModels<T extends NamedModel>(models: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return models;
  if (/^[a-z]$/.test(needle)) {
    return models.filter((model) => nameStartsWith(model, needle));
  }
  const words = searchTokens(needle);
  if (words.length === 0) return [];
  const allowDescription = needle.length >= 3;
  return models.filter((model) => {
    const parts = searchTokens(`${modelLabel(model)} ${model.id}`);
    if (tokensMatch(parts, words)) return true;
    if (!allowDescription) return false;
    return tokensMatch(searchTokens(model.description ?? ""), words);
  });
}

/** Models with a recorded use, most used first. Ties keep catalog order. */
export function orderModelsByUse<T extends { id: string }>(
  models: T[],
  counts: Readonly<Record<string, number>>,
): { frequent: T[]; rest: T[] } {
  const frequent = models.filter((model) => (counts[model.id] ?? 0) > 0);
  frequent.sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0));
  const frequentIds = new Set(frequent.map((model) => model.id));
  return {
    frequent,
    rest: models.filter((model) => !frequentIds.has(model.id)),
  };
}

export function arrangeModelMenu<T extends { id: string }>(
  models: T[],
  preferred: { id: string }[],
  counts: Readonly<Record<string, number>>,
): { frequent: T[]; preferred: T[]; rest: T[] } {
  const ranked = orderModelsByUse(models, counts);
  const grouped = groupPreferredModels(ranked.rest, preferred);
  return {
    frequent: ranked.frequent,
    preferred: grouped.preferred,
    rest: grouped.rest,
  };
}

export function groupPreferredModels<T extends { id: string }>(
  models: T[],
  preferred: { id: string }[],
): { preferred: T[]; rest: T[] } {
  const preferredIds = new Set(preferred.map((model) => model.id));
  return {
    preferred: models.filter((model) => preferredIds.has(model.id)),
    rest: models.filter((model) => !preferredIds.has(model.id)),
  };
}

/** Mode defaults list every catalog model for that mode. A saved id stays selectable. */
export function defaultModelChoices<T extends { id: string }>(
  catalog: T[],
  preferred: { id: string }[],
  currentId: string | undefined,
): { preferred: T[]; rest: Array<T | { id: string }> } {
  const preferredIds = new Set(preferred.map((model) => model.id));
  const starred = catalog.filter((model) => preferredIds.has(model.id));
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
): number {
  if (previousModel && previousModel === nextModel) return currentCount;
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
