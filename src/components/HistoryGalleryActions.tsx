import { useEffect, useRef, useState } from "react";
import type { GallerySummary } from "../lib/api";
import type { HistoryGalleryItem } from "../lib/gallery-history";

type Menu = "add" | "set" | "new";

export function HistoryGalleryActions({
  image,
  setItems,
  summaries,
  onAdd,
  onCreate,
}: {
  image: HistoryGalleryItem | null;
  setItems: HistoryGalleryItem[];
  summaries: GallerySummary[];
  onAdd: (galleryId: string, items: HistoryGalleryItem[]) => Promise<string | null>;
  onCreate: (name: string, items: HistoryGalleryItem[]) => Promise<string | null>;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const showSet = setItems.length > 1;

  useEffect(() => {
    if (!menu) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setMenu(null);
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);

  if (!image && setItems.length === 0) return null;

  function open(next: Menu) {
    setNote(null);
    setMenu((current) => (current === next ? null : next));
  }

  async function add(galleryId: string, items: HistoryGalleryItem[]) {
    if (busy || items.length === 0) return;
    setBusy(true);
    setNote(null);
    const message = await onAdd(galleryId, items);
    setBusy(false);
    if (message) {
      setNote(message);
      return;
    }
    setMenu(null);
  }

  async function create(items: HistoryGalleryItem[]) {
    const trimmed = name.trim();
    if (busy || !trimmed || items.length === 0) return;
    setBusy(true);
    setNote(null);
    const message = await onCreate(trimmed, items);
    setBusy(false);
    if (message) {
      setNote(message);
      return;
    }
    setName("");
    setMenu(null);
  }

  const adding = menu === "add" || menu === "set";
  const incoming = menu === "set" ? setItems : image ? [image] : [];

  return (
    <div className="history-gallery-tools" ref={rootRef}>
      {image ? (
        <button
          type="button"
          className="history-gallery-tool"
          aria-expanded={menu === "add"}
          aria-label="Add this image to a gallery"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => open("add")}
        >
          Add
        </button>
      ) : null}
      {showSet ? (
        <button
          type="button"
          className="history-gallery-tool"
          aria-expanded={menu === "set"}
          aria-label="Add this set to a gallery"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => open("set")}
        >
          Add set
        </button>
      ) : null}
      <button
        type="button"
        className="history-gallery-tool"
        aria-expanded={menu === "new"}
        aria-label="New gallery"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => open("new")}
      >
        New gallery
      </button>
      {adding ? (
        <div className="history-gallery-pop" role="menu" aria-label={menu === "set" ? "Add set" : "Add image"}>
          {summaries.length === 0 ? (
            <p className="history-gallery-note">No galleries yet.</p>
          ) : (
            summaries.map((gallery) => (
              <button
                key={gallery.id}
                type="button"
                role="menuitem"
                className="history-gallery-choice"
                disabled={busy}
                onClick={() => void add(gallery.id, incoming)}
              >
                {gallery.name}
              </button>
            ))
          )}
          {note ? <p className="history-gallery-note">{note}</p> : null}
        </div>
      ) : null}
      {menu === "new" ? (
        <form
          className="history-gallery-pop"
          onSubmit={(event) => {
            event.preventDefault();
            if (image) void create([image]);
            else void create(setItems);
          }}
        >
          <input
            className="field"
            value={name}
            placeholder="Gallery name"
            aria-label="Gallery name"
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
          <div className="history-gallery-new-actions">
            {image ? (
              <button type="submit" className="prompt-action" disabled={busy || !name.trim()}>
                This image
              </button>
            ) : setItems.length > 0 ? (
              <button type="submit" className="prompt-action" disabled={busy || !name.trim()}>
                Create
              </button>
            ) : null}
            {showSet ? (
              <button
                type="button"
                className="prompt-action"
                disabled={busy || !name.trim()}
                onClick={() => void create(setItems)}
              >
                This set
              </button>
            ) : null}
          </div>
          {note ? <p className="history-gallery-note">{note}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
