import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { deleteChoices, deleteMenuArmed, itemCount, type DeleteScope } from "../lib/media-delete";

type Box = { left: number; top?: number; bottom?: number };

const MENU_WIDTH = 336;
/** Room the two rows need. Less than this below the button and the menu opens upward. */
const MENU_HEIGHT = 190;
const EDGE = 8;
const GAP = 6;

function placeMenu(rect: DOMRect): Box {
  const width = Math.min(MENU_WIDTH, window.innerWidth - EDGE * 2);
  const left = Math.max(EDGE, Math.min(rect.right - width, window.innerWidth - width - EDGE));
  const below = window.innerHeight - rect.bottom;
  if (below >= MENU_HEIGHT || below >= rect.top) return { left, top: rect.bottom + GAP };
  return { left, bottom: window.innerHeight - rect.top + GAP };
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M3.2 4.4h9.6M6.2 4.4V3h3.6v1.4M4.6 4.4l.5 8.4h5.8l.5-8.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The one Delete control. The button only opens a menu; the menu holds the two choices, and
 * choosing one is the whole action. Nothing is deleted by the first click.
 */
export function DeleteMenu({
  count,
  onChoose,
  className = "ghost-btn",
  children = "Delete",
  label,
  disabled = false,
}: {
  /** Items the choice will act on. Shown in the menu. */
  count: number;
  onChoose: (scope: DeleteScope) => void;
  className?: string;
  children?: ReactNode;
  /** Accessible name when the button shows only an icon. */
  label?: string;
  disabled?: boolean;
}) {
  const [box, setBox] = useState<Box | null>(null);
  const openedAt = useRef(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = `delete-menu-${useId()}`;
  const open = box !== null;

  useEffect(() => {
    if (!open) return;
    menuRef.current?.focus();
    function close() {
      setBox(null);
    }
    function onPointer(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    }
    // Capture, and claim the key, so the panel holding this menu stays open while the menu closes.
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      triggerRef.current?.focus();
    }
    // The page under the menu can move on its own (an image finishes loading), so the menu
    // follows its button and closes only once the button has left the screen.
    function follow() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.bottom < 0 || rect.top > window.innerHeight) {
        close();
        return;
      }
      setBox(placeMenu(rect));
    }
    function onScroll(event: Event) {
      if (menuRef.current?.contains(event.target as Node)) return;
      follow();
    }
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", follow);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  function toggle(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (open) {
      setBox(null);
      return;
    }
    if (count < 1) return;
    openedAt.current = event.timeStamp;
    setBox(placeMenu(event.currentTarget.getBoundingClientRect()));
  }

  function choose(scope: DeleteScope, at: number) {
    if (!deleteMenuArmed(openedAt.current, at)) return;
    setBox(null);
    onChoose(scope);
  }

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']") ?? [])];
    if (rows.length === 0) return;
    event.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    rows[(at + step + rows.length) % rows.length]?.focus();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${className}${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={toggle}
      >
        {children}
      </button>
      {box
        ? createPortal(
            <div
              ref={menuRef}
              id={menuId}
              className="delete-menu"
              role="menu"
              aria-label={`Delete ${itemCount(count)}`}
              tabIndex={-1}
              style={{ left: box.left, top: box.top, bottom: box.bottom }}
              onKeyDown={onMenuKey}
              onClick={(event) => event.stopPropagation()}
            >
              <p className="delete-menu-head">Delete {itemCount(count)}</p>
              {deleteChoices(count).map((choice) => (
                <button
                  key={choice.scope}
                  type="button"
                  role="menuitem"
                  className={`delete-menu-choice${choice.danger ? " is-danger" : ""}`}
                  onClick={(event) => choose(choice.scope, event.timeStamp)}
                >
                  <strong>{choice.title}</strong>
                  <span>{choice.detail}</span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
