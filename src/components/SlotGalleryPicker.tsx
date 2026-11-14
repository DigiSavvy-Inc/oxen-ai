import { useEffect, useRef, useState } from "react";
import { api, type GalleryItem, type GallerySummary, type SlotFileInput, type StudioSlot } from "../lib/api";
import {
  inSlotKeys,
  pickAll,
  pickBlocked,
  pickCount,
  pickedFiles,
  pickRoom,
  SLOT_PICK_MAX,
  togglePick,
} from "../lib/slot-pick";
import { GalleryThumb } from "./GalleryThumb";
import { Loader } from "./Loader";

type Props = {
  slot: StudioSlot;
  galleries: GallerySummary[];
  onClose: () => void;
  onUseFiles: (files: SlotFileInput[]) => void;
  onLinkGallery: (galleryId: string) => void;
};

/** Mounts the thumb only once the tile scrolls near the panel's view, so a full gallery stays light. */
function LazyThumb(props: { kind: GalleryItem["kind"]; name: string; preview: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [seen]);
  return (
    <span ref={ref} className="slot-pick-thumb">
      {seen ? <GalleryThumb kind={props.kind} name={props.name} preview={props.preview} slot="strip" /> : null}
    </span>
  );
}

export function SlotGalleryPicker(props: Props) {
  const { slot } = props;
  const [galleryId, setGalleryId] = useState<string | null>(null);
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  const backRef = useRef<() => void>(() => {});
  backRef.current = () => {
    setGalleryId(null);
    setItems(null);
    setError(null);
    setPicked(new Set());
  };

  // Capture and claim Escape so the Slots panel stays open while the picker closes.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (!galleryId) return;
    let cancelled = false;
    void api
      .gallery(galleryId)
      .then(({ gallery }) => {
        if (!cancelled) setItems(gallery.items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn’t open that gallery");
      });
    return () => {
      cancelled = true;
    };
  }, [galleryId]);

  const summary = props.galleries.find((gallery) => gallery.id === galleryId) ?? null;
  const linked = Boolean(slot.galleryId);
  const linkedHere = galleryId != null && slot.galleryId === galleryId;
  const count = pickCount(slot, picked);
  const full = pickRoom(slot, picked) === 0;
  const inSlot = inSlotKeys(slot);
  const ownCount = linked ? 0 : slot.files.length;

  return (
    <section className="slot-pick" aria-label={`Add from gallery to @${slot.handle}`}>
      <div className="slot-pick-head">
        {galleryId ? (
          <button type="button" className="ghost-btn" onClick={() => backRef.current()}>
            Back
          </button>
        ) : null}
        <strong>{summary ? summary.name : `Add from gallery to @${slot.handle}`}</strong>
        <button type="button" className="icon-btn" aria-label="Close gallery picker" onClick={props.onClose}>
          ×
        </button>
      </div>
      {!galleryId ? (
        props.galleries.length === 0 ? (
          <p className="slot-empty">No galleries yet.</p>
        ) : (
          <ul className="slot-pick-galleries">
            {props.galleries.map((gallery) => {
              const preview = gallery.previews?.[0];
              const n = gallery.count ?? gallery.items?.length ?? 0;
              return (
                <li key={gallery.id}>
                  <button type="button" className="slot-pick-gallery" onClick={() => setGalleryId(gallery.id)}>
                    <span className="slot-pick-thumb">
                      {preview ? (
                        <GalleryThumb
                          kind={preview.kind}
                          name={preview.name}
                          preview={preview.thumbUrl || preview.mediaUrl || ""}
                          slot="strip"
                        />
                      ) : null}
                    </span>
                    <span className="slot-pick-gallery-text">
                      <span>{gallery.name}</span>
                      <small>
                        {n} {n === 1 ? "item" : "items"}
                        {slot.galleryId === gallery.id ? " · linked to this slot" : ""}
                      </small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : error ? (
        <p className="slot-notice">{error}</p>
      ) : !items ? (
        <Loader label="Loading gallery" />
      ) : (
        <>
          <div className="slot-pick-bar">
            <span className="slot-pick-count" aria-live="polite">
              {count.used} of {count.max}
              {full ? ` · A slot holds ${SLOT_PICK_MAX} files.` : ""}
              {ownCount > 0 ? ` · ${ownCount} already in this slot` : ""}
            </span>
            <button
              type="button"
              className="ghost-btn"
              disabled={full || items.length === 0}
              onClick={() => setPicked(pickAll(slot, items, picked))}
            >
              Select all
            </button>
            <button type="button" className="ghost-btn" disabled={picked.size === 0} onClick={() => setPicked(new Set())}>
              Clear
            </button>
          </div>
          {items.length === 0 ? <p className="slot-empty">This gallery is empty.</p> : null}
          <div className="slot-pick-grid">
            {items.map((item) => {
              const added = inSlot.has(item.key);
              const ticked = picked.has(item.key);
              const blocked = pickBlocked(slot, picked, item.key);
              return (
                <label
                  key={item.id}
                  className={`slot-pick-tile${ticked ? " is-picked" : ""}${blocked ? " is-blocked" : ""}`}
                  title={blocked ?? item.name}
                >
                  <LazyThumb kind={item.kind} name={item.name} preview={item.thumbUrl || item.url || ""} />
                  <input
                    type="checkbox"
                    checked={ticked || added}
                    disabled={Boolean(blocked)}
                    aria-label={added ? `${item.name}, already in this slot` : `Pick ${item.name}`}
                    onChange={() => setPicked(togglePick(slot, picked, item.key))}
                  />
                  {added ? <span className="slot-pick-added">In slot</span> : null}
                </label>
              );
            })}
          </div>
          <div className="slot-pick-actions">
            <button
              type="button"
              className="primary-btn"
              disabled={picked.size === 0}
              onClick={() => props.onUseFiles(pickedFiles(slot, items, picked))}
            >
              {linked ? `Use only these (${picked.size})` : `Add selected (${picked.size})`}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={linkedHere}
              onClick={() => galleryId && props.onLinkGallery(galleryId)}
            >
              {linkedHere ? "Whole gallery in use" : "Use whole gallery"}
            </button>
          </div>
          {!linkedHere && ownCount > 0 ? (
            <p className="slot-drop-hint">Use whole gallery puts the gallery in place of this slot’s own files.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
