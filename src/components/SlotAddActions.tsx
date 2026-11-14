import { useEffect, useRef, useState } from "react";
import {
  slotAddNoticeText,
  slotRowMark,
  type SlotAddItem,
  type SlotAddNotice,
  type SlotChoice,
} from "../lib/slot-add";

/**
 * Add to slot, beside Add to gallery. The menu lists the slots usable right now and New slot…,
 * and stays open after a choice to say how many went in.
 */
export function SlotAddActions({
  items,
  slots,
  onAdd,
  onCreate,
  label = "Add to slot",
  placement = "above",
  buttonClassName = "history-gallery-tool",
}: {
  items: SlotAddItem[];
  slots: SlotChoice[];
  onAdd: (slotId: string, items: SlotAddItem[]) => Promise<SlotAddNotice>;
  onCreate: (name: string, items: SlotAddItem[]) => Promise<SlotAddNotice>;
  label?: string;
  placement?: "above" | "below";
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<SlotAddNotice | null>(null);
  const [noticeId, setNoticeId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const empty = items.length === 0;

  function close() {
    setOpen(false);
    setNaming(false);
    setNotice(null);
    setNoticeId(null);
  }

  useEffect(() => {
    if (!open) return;
    function shut() {
      setOpen(false);
      setNaming(false);
      setNotice(null);
      setNoticeId(null);
    }
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) shut();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      shut();
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  async function add(slotId: string) {
    if (pendingId || empty) return;
    setPendingId(slotId);
    setNotice(null);
    setNoticeId(null);
    const result = await onAdd(slotId, items);
    setPendingId(null);
    setNotice(result);
    setNoticeId(slotId);
  }

  async function create() {
    const trimmed = name.trim();
    if (pendingId || empty || !trimmed) return;
    setPendingId("new");
    setNotice(null);
    setNoticeId(null);
    const result = await onCreate(trimmed, items);
    setPendingId(null);
    setNotice(result);
    if (result.kind === "added") {
      setName("");
      setNaming(false);
    }
  }

  const noticeText = notice ? slotAddNoticeText(notice) : null;

  return (
    <div
      className={`history-gallery-tools history-slot-tools${placement === "below" ? " is-below" : ""}`}
      ref={rootRef}
    >
      <button
        type="button"
        className={buttonClassName}
        aria-expanded={open}
        disabled={empty}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {label}
      </button>
      {open ? (
        <div className="history-gallery-pop" role="menu" aria-label={label}>
          {noticeText ? (
            <p className="history-gallery-confirm" role="status">
              {noticeText}
            </p>
          ) : null}
          <div className="history-gallery-choices">
            {slots.length === 0 ? <p className="history-gallery-note">No slots yet.</p> : null}
            {slots.map((slot) => {
              const marked = noticeId === slot.id && notice ? slotRowMark(notice) : null;
              return (
                <button
                  key={slot.id}
                  type="button"
                  role="menuitem"
                  className={`history-gallery-choice${marked ? " is-done" : ""}`}
                  disabled={Boolean(pendingId) || Boolean(slot.disabledReason)}
                  title={slot.disabledReason ? `${slot.disabledReason}. Its files come from that gallery.` : undefined}
                  onClick={() => void add(slot.id)}
                >
                  <span className="history-gallery-choice-name">{slot.name}</span>
                  {pendingId === slot.id ? <span className="history-gallery-choice-status">Adding…</span> : null}
                  {marked ? <span className="history-gallery-choice-status">{marked}</span> : null}
                  {slot.disabledReason ? (
                    <span className="history-gallery-choice-status is-muted">{slot.disabledReason}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {naming ? (
            <form
              className="history-slot-new"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <input
                className="field"
                value={name}
                placeholder="Slot name"
                aria-label="Slot name"
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
              <button type="submit" className="prompt-action" disabled={Boolean(pendingId) || !name.trim()}>
                {pendingId === "new" ? "Creating…" : "Create"}
              </button>
            </form>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="history-gallery-choice"
              disabled={Boolean(pendingId)}
              onClick={() => {
                setNotice(null);
                setNoticeId(null);
                setNaming(true);
              }}
            >
              <span className="history-gallery-choice-name">New slot…</span>
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
