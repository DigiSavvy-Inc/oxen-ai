import { useEffect, useEffectEvent, type RefObject } from "react";

/** Closes a small menu on a press outside it or on Escape. */
export function usePopClose(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  const onClose = useEffectEvent(close);
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) onClose();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, ref]);
}
