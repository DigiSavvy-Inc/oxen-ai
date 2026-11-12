import { useCallback, useEffect, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { GALLERY_ITEM_DRAG_TYPE } from "./gallery-attach";
import { indexAfterInsertBefore } from "./mentions";

/** Controls on a tile that keep their own press: a drag never starts from one. */
const TILE_CONTROLS = "input, select, label, .gallery-remove, .gallery-tile-actions";

export type TileDropSide = "before" | "after";

/** The gap the pointer is over: before this tile on its left half, after it on its right half. */
export function insertBeforeAt(index: number, left: number, width: number, clientX: number): number {
  return clientX < left + width / 2 ? index : index + 1;
}

/** Where the dragged tile lands, or null when the drop leaves the order as it is. */
export function reorderTarget(from: number, insertBefore: number, count: number): number | null {
  if (!Number.isInteger(from) || from < 0 || from >= count) return null;
  const gap = Math.max(0, Math.min(Math.trunc(insertBefore), count));
  const to = indexAfterInsertBefore(from, gap);
  return to === from ? null : to;
}

/** Which edge of the tile shows the drop line. Null when dropping there would not move anything. */
export function tileDropSide(index: number, from: number, insertBefore: number | null): TileDropSide | null {
  if (insertBefore == null || from < 0) return null;
  if (insertBefore === from || insertBefore === from + 1) return null;
  if (insertBefore === index) return "before";
  if (insertBefore === index + 1) return "after";
  return null;
}

type Options<T> = {
  items: readonly T[];
  onReorder: (from: number, to: number) => void;
  onDragChange?: (dragging: boolean) => void;
};

/**
 * Drag a tile to a new place in its set. The drag also carries the tile's id, so the prompt can
 * take the same drag as one attachment.
 */
export function useTileReorder<T extends { id: string }>(options: Options<T>) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ index: number; insertBefore: number } | null>(null);
  const pressedControl = useRef(false);
  const { onDragChange } = options;

  const finish = useCallback(() => {
    setDragId(null);
    setOver(null);
    onDragChange?.(false);
  }, [onDragChange]);

  useEffect(() => {
    if (dragId == null) return;
    // The browser sends no mouse events during a drag, so the first one means the drag is over.
    // This covers a tile that left the page mid-drag and never received dragend.
    window.addEventListener("mousemove", finish);
    return () => window.removeEventListener("mousemove", finish);
  }, [dragId, finish]);

  const from = dragId == null ? -1 : options.items.findIndex((item) => item.id === dragId);

  function tile(index: number, item: T) {
    const side = over && over.index === index ? tileDropSide(index, from, over.insertBefore) : null;
    return {
      dragging: dragId === item.id,
      side,
      handlers: {
        draggable: true,
        onPointerDown(event: PointerEvent<HTMLElement>) {
          pressedControl.current = Boolean((event.target as HTMLElement).closest(TILE_CONTROLS));
        },
        onDragStart(event: DragEvent<HTMLElement>) {
          if (pressedControl.current) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.effectAllowed = "copyMove";
          event.dataTransfer.setData(GALLERY_ITEM_DRAG_TYPE, item.id);
          setDragId(item.id);
          onDragChange?.(true);
        },
        onDragOver(event: DragEvent<HTMLElement>) {
          if (dragId == null) return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          const rect = event.currentTarget.getBoundingClientRect();
          const insertBefore = insertBeforeAt(index, rect.left, rect.width, event.clientX);
          if (over?.index !== index || over.insertBefore !== insertBefore) setOver({ index, insertBefore });
        },
        onDragEnd: finish,
      },
    };
  }

  const set = {
    onDragOver(event: DragEvent<HTMLElement>) {
      if (dragId == null) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    onDrop(event: DragEvent<HTMLElement>) {
      if (dragId == null) return;
      event.preventDefault();
      const to = over ? reorderTarget(from, over.insertBefore, options.items.length) : null;
      finish();
      if (to != null) options.onReorder(from, to);
    },
  };

  return { dragging: dragId != null, tile, set };
}
