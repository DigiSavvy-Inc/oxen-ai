import { useEffect, useRef, useState } from "react";
import type { GallerySummary } from "../lib/api";
import {
  historyGalleryNoticeText,
  type HistoryGalleryItem,
  type HistoryGalleryNotice,
} from "../lib/gallery-history";

type Menu = "add" | "set" | "new";

export function HistoryGalleryActions({
  items,
  wholeSet,
  summaries,
  onAdd,
  onCreate,
  addLabel = "Add to gallery",
  placement = "above",
}: {
  /** What Add to gallery and New gallery take: the ticked items, or the one being shown. */
  items: HistoryGalleryItem[];
  /** Given with more than one item, the whole group can also be added in one click. */
  wholeSet?: HistoryGalleryItem[];
  summaries: GallerySummary[];
  onAdd: (galleryId: string, items: HistoryGalleryItem[]) => Promise<HistoryGalleryNotice>;
  onCreate: (name: string, items: HistoryGalleryItem[]) => Promise<HistoryGalleryNotice>;
  addLabel?: string;
  placement?: "above" | "below";
}) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<HistoryGalleryNotice | null>(null);
  const [noticeId, setNoticeId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const setItems = wholeSet ?? [];
  const showSet = setItems.length > 1;
  const empty = items.length === 0;
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
  const incoming = menu === "set" ? setItems : items;

  return (
    <div className={`history-gallery-tools${placement === "below" ? " is-below" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="history-gallery-tool"
        aria-expanded={menu === "add"}
        disabled={empty}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => open("add")}
      >
        {addLabel}
      </button>
      {showSet ? (
        <button
          type="button"
          className="history-gallery-tool"
          aria-expanded={menu === "set"}
          aria-label={`Add all ${setItems.length} to a gallery`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => open("set")}
        >
          Add all {setItems.length}
        </button>
      ) : null}
      <button
        type="button"
        className="history-gallery-tool"
        aria-expanded={menu === "new"}
        disabled={empty && !showSet}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => open("new")}
      >
        New gallery
      </button>
      {adding ? (
        <div
          className="history-gallery-pop"
          role="menu"
          aria-label={menu === "set" ? `Add all ${setItems.length} to a gallery` : addLabel}
        >
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
            void create(empty ? setItems : items);
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
            {!empty ? (
              <button type="submit" className="prompt-action" disabled={Boolean(pendingId) || !name.trim()}>
                {pendingId === "new"
                  ? "Creating…"
                  : showSet
                    ? "This one"
                    : items.length > 1
                      ? `Create with ${items.length}`
                      : "Create"}
              </button>
            ) : null}
            {showSet ? (
              <button
                type={empty ? "submit" : "button"}
                className="prompt-action"
                disabled={Boolean(pendingId) || !name.trim()}
                onClick={empty ? undefined : () => void create(setItems)}
              >
                All {setItems.length}
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
