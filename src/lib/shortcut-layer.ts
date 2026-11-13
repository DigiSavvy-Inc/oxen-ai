type ChordTarget = {
  tagName?: unknown;
  isContentEditable?: unknown;
  closest?: (selector: string) => unknown;
  getAttribute?: (name: string) => string | null;
  querySelectorAll?: (selector: string) => Iterable<ChordTarget>;
};

const TEXT_FIELD = "input, textarea, select, [contenteditable='true'], [role='textbox']";
const MENU = "[role='menu'], [role='listbox']";

function asTarget(target: unknown): ChordTarget | null {
  if (typeof target !== "object" || target === null) return null;
  return target as ChordTarget;
}

function shortcutEndsWithG(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.split(/\s+/).some((part) => part.split("+").at(-1)?.toUpperCase() === "G");
}

function textField(target: ChordTarget): boolean {
  if (target.isContentEditable === true) return true;
  if (typeof target.tagName === "string") {
    const tag = target.tagName.toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  }
  try {
    if (target.getAttribute?.("role") === "textbox") return true;
    return target.closest?.(TEXT_FIELD) != null;
  } catch {
    return false;
  }
}

/** An open menu uses ⌘⇧G when it, or an item inside it, advertises that key. */
function menuUsesGalleryKey(target: ChordTarget): boolean {
  let menu: unknown;
  try {
    menu = target.closest?.(MENU);
  } catch {
    return false;
  }
  if (typeof menu !== "object" || menu === null) return false;
  const node = menu as ChordTarget;
  if (shortcutEndsWithG(node.getAttribute?.("aria-keyshortcuts"))) return true;
  try {
    const marked = node.querySelectorAll?.("[aria-keyshortcuts]");
    if (!marked) return false;
    for (const item of marked) {
      if (shortcutEndsWithG(item.getAttribute?.("aria-keyshortcuts"))) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * ⌘⇧G stays with a text field, and with a menu that already claimed the key or advertises it.
 * The window handler leaves the event alone in those cases, so the field or the menu keeps it.
 */
export function galleryChordTaken(event: { defaultPrevented: boolean; target: unknown }): boolean {
  if (event.defaultPrevented) return true;
  const target = asTarget(event.target);
  if (!target) return false;
  return textField(target) || menuUsesGalleryKey(target);
}
