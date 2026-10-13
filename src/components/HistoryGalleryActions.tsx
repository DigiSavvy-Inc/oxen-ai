import { useEffect, useRef, useState } from "react";
import type { GallerySummary } from "../lib/api";
import {
  historyGalleryNoticeText,
  type HistoryGalleryItem,
  type HistoryGalleryNotice,
} from "../lib/gallery-history";

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
  onAdd: (galleryId: string, items: HistoryGalleryItem[]) => Promise<HistoryGalleryNotice>;
  onCreate: (name: string, items: HistoryGalleryItem[]) => Promise<HistoryGalleryNotice>;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<HistoryGalleryNotice | null>(null);
  const [noticeId, setNoticeId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const showSet = setItems.length > 1;
  const noticeText = notice ? historyGalleryNoticeText(notice) : null;

  useEffect(() => {
    if (!menu) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenu(null);
        setNotice(null);
        setNoticeId(null);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setMenu(null);
      setNotice(null);
      setNoticeId(null);
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
    setNotice(null);
    setNoticeId(null);
    setMenu((current) => (current === next ? null : next));
  }

  async function add(galleryId: string, items: HistoryGalleryItem[]) {
    if (pendingId || items.length === 0) return;
    setPendingId(galleryId);
    setNotice(null);
    setNoticeId(null);
    const result = await onAdd(galleryId, items);
    setPendingId(null);
    setNotice(result);
    setNoticeId(galleryId);
  }

  async function create(items: HistoryGalleryItem[]) {
    const trimmed = name.trim();
    if (pendingId || !trimmed || items.length === 0) return;
    setPendingId("new");
    setNotice(null);
    const result = await onCreate(trimmed, items);
    setPendingId(null);
    setNotice(result);
    if (result.kind === "created") setName("");
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
          {noticeText ? (
            <p className="history-gallery-confirm" role="status">
              {noticeText}
            </p>
          ) : null}
          <div className="history-gallery-choices">
            {summaries.length === 0 ? (
              <p className="history-gallery-note">No galleries yet.</p>
            ) : (
              summaries.map((gallery) => {
                const pending = pendingId === gallery.id;
                const marked = noticeId === gallery.id && notice ? rowMark(notice) : null;
                return (
                  <button
                    key={gallery.id}
                    type="button"
                    role="menuitem"
                    className={`history-gallery-choice${marked ? " is-done" : ""}`}
                    disabled={Boolean(pendingId)}
                    onClick={() => void add(gallery.id, incoming)}
                  >
                    <span className="history-gallery-choice-name">{gallery.name}</span>
                    {pending ? <span className="history-gallery-choice-status">Adding…</span> : null}
                    {marked ? <span className="history-gallery-choice-status">{marked}</span> : null}
                  </button>
                );
              })
            )}
          </div>
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
          {noticeText ? (
            <p className="history-gallery-confirm" role="status">
              {noticeText}
            </p>
          ) : null}
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
              <button type="submit" className="prompt-action" disabled={Boolean(pendingId) || !name.trim()}>
                {pendingId === "new" ? "Creating…" : "This image"}
              </button>
            ) : setItems.length > 0 ? (
              <button type="submit" className="prompt-action" disabled={Boolean(pendingId) || !name.trim()}>
                {pendingId === "new" ? "Creating…" : "Create"}
              </button>
            ) : null}
            {showSet ? (
              <button
                type="button"
                className="prompt-action"
                disabled={Boolean(pendingId) || !name.trim()}
                onClick={() => void create(setItems)}
              >
                This set
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}

function rowMark(notice: HistoryGalleryNotice): string | null {
  switch (notice.kind) {
    case "added":
      return "Added";
    case "already":
      return "Already in";
    case "created":
    case "error":
      return null;
    default: {
      const unreachable: never = notice;
      return unreachable;
    }
  }
}
