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

export type ModelMenuKeyAction =
  | { type: "query"; query: string }
  | { type: "move"; delta: 1 | -1 }
  | { type: "home" }
  | { type: "end" }
  | { type: "choose" }
  | { type: "close" };

/** Keys that filter or move the open model menu. Text fields handle their own input. */
export function modelMenuKeyAction(
  key: string,
  query: string,
  mods: { metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; isComposing?: boolean } = {},
): ModelMenuKeyAction | null {
  if (mods.metaKey || mods.ctrlKey || mods.altKey || mods.isComposing) return null;
  switch (key) {
    case "ArrowDown":
      return { type: "move", delta: 1 };
    case "ArrowUp":
      return { type: "move", delta: -1 };
    case "Home":
      return { type: "home" };
    case "End":
      return { type: "end" };
    case "Enter":
      return { type: "choose" };
    case "Escape":
      return { type: "close" };
    case "Backspace":
      return { type: "query", query: query.slice(0, -1) };
    case "Tab":
      return null;
    default:
      if (key.length === 1) return { type: "query", query: query + key };
      return null;
  }
}

export type ModelMenuPlacement = {
  left: number;
  width: number;
  maxHeight: number;
} & ({ edge: "top"; top: number } | { edge: "bottom"; bottom: number });

/**
 * Place the menu in visual-viewport coordinates.
 * `top` hangs the menu below the trigger. `bottom` is the distance from the
 * visual viewport's bottom edge up to the menu, so a short list still hugs the trigger.
 */
export function placeModelMenu(input: {
  trigger: { top: number; bottom: number; left: number };
  viewport: { width: number; height: number };
}): ModelMenuPlacement {
  const margin = 8;
  const gap = 6;
  const cap = 320;
  const width = Math.min(cap, Math.max(0, input.viewport.width - margin * 2));
  const maxLeft = Math.max(margin, input.viewport.width - width - margin);
  const left = Math.min(Math.max(input.trigger.left, margin), maxLeft);
  const spaceAbove = input.trigger.top - margin;
  const spaceBelow = input.viewport.height - input.trigger.bottom - margin;
  const openUp = spaceAbove >= spaceBelow;

  if (openUp) {
    const bottomEdge = Math.min(input.trigger.top - gap, input.viewport.height - margin);
    const maxHeight = Math.min(cap, Math.max(0, bottomEdge - margin));
    return { edge: "bottom", left, width, maxHeight, bottom: input.viewport.height - bottomEdge };
  }

  const top = Math.min(
    Math.max(margin, input.trigger.bottom + gap),
    Math.max(margin, input.viewport.height - margin),
  );
  const maxHeight = Math.min(cap, Math.max(0, input.viewport.height - margin - top));
  return { edge: "top", left, width, maxHeight, top };
}

/** Convert a visual-viewport placement into layout-viewport fixed coordinates. */
export function modelMenuCssBox(
  placement: ModelMenuPlacement,
  frame: { offsetTop: number; offsetLeft: number; layoutHeight: number; visualHeight: number },
): { left: number; width: number; maxHeight: number; top?: number; bottom?: number } {
  const left = placement.left + frame.offsetLeft;
  const shared = { left, width: placement.width, maxHeight: placement.maxHeight };
  switch (placement.edge) {
    case "top":
      return { ...shared, top: placement.top + frame.offsetTop };
    case "bottom":
      return {
        ...shared,
        bottom: frame.layoutHeight - (frame.offsetTop + frame.visualHeight - placement.bottom),
      };
    default: {
      const _exhaustive: never = placement;
      return _exhaustive;
    }
  }
}
