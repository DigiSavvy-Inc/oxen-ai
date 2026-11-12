type EscapeEvent = {
  defaultPrevented: boolean;
  target: unknown;
};

function openSelect(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const el = target as { tagName?: unknown; matches?: (selector: string) => boolean };
  if (typeof el.tagName !== "string" || el.tagName.toUpperCase() !== "SELECT") return false;
  try {
    return el.matches?.(":open") === true;
  } catch {
    // Older browsers reject :open. They close the list themselves before the page hears the key.
    return false;
  }
}

/**
 * True when Escape already belongs to something above the panels: a menu, an editor, or a
 * lightbox that claimed the key, or a select whose list is showing. The panel stays open.
 */
export function escapeTaken(event: EscapeEvent): boolean {
  return event.defaultPrevented || openSelect(event.target);
}
