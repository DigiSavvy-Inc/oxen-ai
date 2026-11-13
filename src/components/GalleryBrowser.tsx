import { useEffect, useRef, useState, type DragEvent } from "react";
import { createPortal, flushSync } from "react-dom";
import type { GallerySummary } from "../lib/api";
import type { GalleryDraftItem } from "../lib/gallery-draft";
import { gallerySwipeSlides } from "../lib/gallery-slides";
import { fileDragOffered, historyDragOffered, readHistoryDrag } from "../lib/history-drag";
import { useTileReorder } from "../lib/tile-reorder";
import type { MediaRole } from "../../worker/schema";
import { FullSizeMedia } from "./FullSizeMedia";
import { GalleryRoleSelect } from "./GalleryRoleSelect";
import { GallerySections } from "./GallerySections";
import { GalleryThumb } from "./GalleryThumb";

export type GalleryPlace = {
  ids: string[];
  mode: "copy" | "move";
  targetId: string | null;
  newName: string;
};

type Props = {
  summaries: GallerySummary[];
  detail: boolean;
  galleryId: string | null;
  name: string;
  items: GalleryDraftItem[];
  saving: boolean;
  adding: boolean;
  status: string | null;
  skipped: string[];
  accept: string;
  dropLabel: string;
  onAddFiles: (files: FileList | File[] | null) => void;
  onDropHistory: (ids: string[]) => void;
  onOpen: (id: string) => void;
  onBack: () => void;
  onNameChange: (value: string) => void;
  onSave: () => void;
  onAttach: (items?: GalleryDraftItem[]) => void;
  attachedKeys?: ReadonlySet<string>;
  onRemove: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  onTileDrag?: (dragging: boolean) => void;
  onRoleChange: (index: number, role: MediaRole) => void;
  onFeature: (index: number) => void;
  onDelete: () => void;
  onRenameGallery: (id: string, name: string) => void;
  onDeleteGallery: (id: string) => void;
  onDeleteSelected: (ids: string[]) => Promise<boolean>;
  onPlaceSelected: (input: GalleryPlace) => Promise<boolean>;
};

export function GalleryBrowser(props: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmSelected, setConfirmSelected] = useState(false);
  const [destination, setDestination] = useState("");
  const [newName, setNewName] = useState("");
  const [fitId, setFitId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [dropHot, setDropHot] = useState(false);
  const dropDepth = useRef(0);
  const reorder = useTileReorder({
    items: props.items,
    onReorder: props.onReorder,
    onDragChange: props.onTileDrag,
  });

  useEffect(() => {
    setSelected([]);
    setConfirmSelected(false);
    setFitId(null);
    setPlaying(null);
  }, [props.galleryId]);

  if (!props.detail) {
    return (
      <div className="gallery-browser" aria-label="Galleries">
        {props.status ? <p className="gallery-status">{props.status}</p> : null}
        {props.summaries.length === 0 ? (
          <div className="history-empty">No galleries yet. Create one, then pick library tiles.</div>
        ) : (
          <div className="gallery-card-list">
            {props.summaries.map((gallery) => (
              <GalleryCard
                key={gallery.id}
                gallery={gallery}
                onOpen={props.onOpen}
                onRename={props.onRenameGallery}
                onDelete={props.onDeleteGallery}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const canSave = Boolean(props.name.trim()) && !props.saving;
  const selectedItems = props.items.filter((item) => selected.includes(item.id));
  const allSelected = props.items.length > 0 && selectedItems.length === props.items.length;
  const viewSlides = gallerySwipeSlides(props.items);
  const fit = viewSlides.find((slide) => slide.id === fitId) ?? null;
  const others = props.summaries.filter((gallery) => gallery.id !== props.galleryId);
  const canPlace =
    selectedItems.length > 0 &&
    !props.saving &&
    (destination === "new" ? Boolean(newName.trim()) : Boolean(destination));

  function openSlide(item: GalleryDraftItem) {
    setPlaying(null);
    flushSync(() => setFitId(item.id));
    if (item.kind !== "video") return;
    const video = document.querySelector(".fullsize-backdrop video[controls]");
    if (video instanceof HTMLVideoElement) void video.play().catch(() => {});
  }

  function toggle(id: string) {
    setConfirmSelected(false);
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function clearSelected() {
    setConfirmSelected(false);
    setSelected([]);
  }

  function toggleAll() {
    setConfirmSelected(false);
    setSelected(allSelected ? [] : props.items.map((item) => item.id));
  }

  async function place(mode: "copy" | "move") {
    if (!canPlace) return;
    const ok = await props.onPlaceSelected({
      ids: selectedItems.map((item) => item.id),
      mode,
      targetId: destination === "new" ? null : destination,
      newName,
    });
    if (!ok) return;
    setSelected([]);
    setDestination("");
    setNewName("");
  }

  function offeredDrop(event: DragEvent) {
    const types = event.dataTransfer.types;
    return fileDragOffered(types) || historyDragOffered(types);
  }

  function onDragEnter(event: DragEvent) {
    if (!offeredDrop(event)) return;
    event.preventDefault();
    dropDepth.current += 1;
    setDropHot(true);
  }

  function onDragOver(event: DragEvent) {
    if (!offeredDrop(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(event: DragEvent) {
    if (!offeredDrop(event)) return;
    dropDepth.current -= 1;
    if (dropDepth.current <= 0) {
      dropDepth.current = 0;
      setDropHot(false);
    }
  }

  function onDrop(event: DragEvent) {
    if (!offeredDrop(event)) return;
    event.preventDefault();
    dropDepth.current = 0;
    setDropHot(false);
    if (fileDragOffered(event.dataTransfer.types)) {
      props.onAddFiles(event.dataTransfer.files);
      return;
    }
    const ids = readHistoryDrag(event.dataTransfer);
    if (ids.length > 0) props.onDropHistory(ids);
  }

  return (
    <div
      className={`gallery-browser${dropHot ? " is-drop-hot" : ""}`}
      aria-label="Gallery"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="gallery-manage-head">
        <button type="button" className="ghost-btn" onClick={props.onBack}>
          Galleries
        </button>
        <input
          className="field gallery-name"
          value={props.name}
          placeholder="Gallery name"
          aria-label="Gallery name"
          onChange={(event) => props.onNameChange(event.target.value)}
        />
      </div>
      <div className="gallery-manage-actions">
        <button type="button" className="ghost-btn" disabled={!canSave} onClick={props.onSave}>
          {props.saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={props.items.length === 0}
          onClick={() => props.onAttach()}
        >
          Attach all
        </button>
        <button type="button" className="ghost-btn" disabled={props.items.length === 0} onClick={toggleAll}>
          {allSelected ? "Clear" : "Select all"}
        </button>
        {confirmDelete ? (
          <button
            type="button"
            className="ghost-btn gallery-delete"
            onClick={() => {
              setConfirmDelete(false);
              props.onDelete();
            }}
          >
            Delete this gallery
          </button>
        ) : (
          <button type="button" className="ghost-btn" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
      </div>
      {selectedItems.length > 0 ? (
        <div className="gallery-bulk">
          <span className="gallery-bulk-count">
            {selectedItems.length} selected
          </span>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => props.onAttach(selectedItems)}
          >
            Attach
          </button>
          <button type="button" className="ghost-btn" title="Clear the selection" onClick={clearSelected}>
            Clear
          </button>
          {confirmSelected ? (
            <button
              type="button"
              className="ghost-btn gallery-delete"
              disabled={props.saving}
              onClick={() => {
                const ids = selectedItems.map((item) => item.id);
                setConfirmSelected(false);
                void props.onDeleteSelected(ids).then((ok) => {
                  if (ok) setSelected([]);
                });
              }}
            >
              Remove {selectedItems.length} {selectedItems.length === 1 ? "item" : "items"} from gallery
            </button>
          ) : (
            <button
              type="button"
              className="ghost-btn"
              title="Takes the selection out of this gallery. The files stay in the library."
              onClick={() => setConfirmSelected(true)}
            >
              Remove from gallery
            </button>
          )}
          <select
            className="field"
            aria-label="Destination gallery"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          >
            <option value="">Choose a gallery</option>
            {others.map((gallery) => (
              <option key={gallery.id} value={gallery.id}>
                {gallery.name}
              </option>
            ))}
            <option value="new">New gallery</option>
          </select>
          {destination === "new" ? (
            <input
              className="field"
              value={newName}
              placeholder="New gallery name"
              aria-label="New gallery name"
              onChange={(event) => setNewName(event.target.value)}
            />
          ) : null}
          <button type="button" className="ghost-btn" disabled={!canPlace} onClick={() => void place("copy")}>
            Copy
          </button>
          <button type="button" className="ghost-btn" disabled={!canPlace} onClick={() => void place("move")}>
            Move
          </button>
        </div>
      ) : null}
      {props.skipped.length > 0 ? <p className="gallery-skipped">Skipped {props.skipped.join(", ")}</p> : null}
      {props.status ? <p className="gallery-status">{props.status}</p> : null}
      <label className={`gallery-drop${dropHot ? " is-hot" : ""}`}>
        {props.adding ? "Adding…" : props.dropLabel || "Drop media"}
        <span className="gallery-drop-hint">Images, video, and audio sort into their own groups.</span>
        <input
          type="file"
          accept={props.accept}
          multiple
          onChange={(event) => {
            props.onAddFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
      {props.items.length === 0 ? (
        <div className="history-empty">This gallery is empty.</div>
      ) : (
        <div className="gallery-manage-set" {...reorder.set}>
        <GallerySections
          items={props.items}
          gridClassName="gallery-manage-grid"
          renderItem={(item, index) => {
            const attached = itemAttached(item, props.attachedKeys);
            const drag = reorder.tile(index, item);
            return (
            <div
              key={item.id}
              className={`gallery-manage-tile${selected.includes(item.id) ? " is-selected" : ""}${drag.dragging ? " is-dragging" : ""}${drag.side ? ` is-drop-${drag.side}` : ""}`}
              {...drag.handlers}
            >
              {(item.kind === "image" || item.kind === "video") && item.url ? (
                <button
                  type="button"
                  className="gallery-tile-hit"
                  draggable
                  aria-label={`Open ${item.name}`}
                  onClick={() => openSlide(item)}
                >
                  <GalleryThumb kind={item.kind} name={item.name} preview={item.preview} slot="tile" />
                </button>
              ) : (
                <GalleryThumb kind={item.kind} name={item.name} preview={item.preview} slot="tile" />
              )}
              <label className="gallery-select">
                <input
                  type="checkbox"
                  checked={selected.includes(item.id)}
                  aria-label={`Select ${item.name}`}
                  onChange={() => toggle(item.id)}
                />
              </label>
              <button
                type="button"
                className="gallery-remove"
                aria-label={`Remove ${item.name}`}
                onClick={() => props.onRemove(index)}
              >
                ×
              </button>
              <div className="gallery-tile-actions">
                {item.kind === "image" || item.kind === "video" ? (
                  <GalleryRoleSelect
                    name={item.name}
                    role={item.role}
                    onChange={(role) => props.onRoleChange(index, role)}
                  />
                ) : null}
                {item.kind === "video" && item.url ? (
                  <button
                    type="button"
                    className="gallery-attach-one gallery-play"
                    aria-label={`Play ${item.name}`}
                    title="Play"
                    onClick={() => openSlide(item)}
                  >
                    <PlayIcon />
                  </button>
                ) : null}
                {item.kind === "audio" && item.url ? (
                  <button
                    type="button"
                    className="gallery-attach-one gallery-play"
                    aria-label={`Play ${item.name}`}
                    title="Play"
                    onClick={() => {
                      setFitId(null);
                      setPlaying({ id: item.id, src: item.url, name: item.name });
                    }}
                  >
                    <PlayIcon />
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`gallery-attach-one${attached ? " is-attached" : ""}`}
                  aria-label={`${attached ? "Attached" : "Attach"} ${item.name}`}
                  title={attached ? "Attached" : "Attach"}
                  onClick={() => props.onAttach([item])}
                >
                  {attached ? <AttachedIcon /> : <AttachIcon />}
                </button>
                {index > 0 && item.kind === "image" ? (
                  <button
                    type="button"
                    className="gallery-feature"
                    aria-label={`Feature ${item.name}`}
                    title="Feature"
                    onClick={() => props.onFeature(index)}
                  >
                    <FeatureIcon />
                  </button>
                ) : null}
              </div>
            </div>
            );
          }}
        />
        </div>
      )}
      {fit ? (
        <FullSizeMedia
          src={fit.src}
          alt={fit.alt}
          slides={viewSlides}
          mediaType={fit.mediaType}
          autoPlay={fit.mediaType === "video"}
          activeId={fit.id}
          onSlide={setFitId}
          onClose={() => setFitId(null)}
        />
      ) : null}
      {playing ? (
        <GalleryAudioPop src={playing.src} name={playing.name} onClose={() => setPlaying(null)} />
      ) : null}
    </div>
  );
}

function GalleryCard({
  gallery,
  onOpen,
  onRename,
  onDelete,
}: {
  gallery: GallerySummary;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(gallery.name);
  const [confirm, setConfirm] = useState(false);
  const previews = gallery.previews ?? [];
  const count = gallery.count ?? previews.length;
  const featured = count > 4;

  return (
    <div className="gallery-card">
      <button type="button" className="gallery-card-open" onClick={() => onOpen(gallery.id)}>
        <span className={`gallery-card-mosaic${featured ? " is-featured" : ""}`}>
          {previews.length === 0 ? (
            <span className="gallery-card-thumb">
              <span className="gallery-audio">Empty</span>
            </span>
          ) : (
            previews.map((item, index) => (
              <span key={`${gallery.id}-${index}`} className="gallery-card-thumb">
                {item.thumbUrl || (item.kind === "video" && item.mediaUrl) ? (
                  <GalleryThumb
                    kind={item.kind}
                    name={item.name}
                    preview={item.thumbUrl || item.mediaUrl || ""}
                    slot={featured && index === 0 ? "cover" : "strip"}
                  />
                ) : (
                  <span className="gallery-audio">
                    {item.kind === "video" ? "Video" : item.kind === "audio" ? "Audio" : "Image"}
                  </span>
                )}
              </span>
            ))
          )}
        </span>
      </button>
      <div className="gallery-card-meta">
        {editing ? (
          <form
            className="gallery-card-editor"
            onSubmit={(event) => {
              event.preventDefault();
              const name = draft.trim();
              if (!name || name === gallery.name) {
                setEditing(false);
                return;
              }
              onRename(gallery.id, name);
              setEditing(false);
            }}
          >
            <input
              className="field"
              value={draft}
              aria-label="Gallery name"
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                setDraft(gallery.name);
                setEditing(false);
              }}
            />
            <button type="submit" className="prompt-action" disabled={!draft.trim()}>
              Save changes
            </button>
          </form>
        ) : (
          <>
            <button type="button" className="gallery-card-name" onClick={() => onOpen(gallery.id)}>
              {gallery.name}
            </button>
            <span className="gallery-card-count">
              {count} {count === 1 ? "item" : "items"}
            </span>
            <span className="gallery-card-tools">
              <button
                type="button"
                className="saved-prompt-edit"
                aria-label={`Edit ${gallery.name}`}
                onClick={() => {
                  setDraft(gallery.name);
                  setEditing(true);
                  setConfirm(false);
                }}
              >
                <PencilIcon />
                Edit
              </button>
              {confirm ? (
                <button
                  type="button"
                  className="saved-prompt-edit gallery-delete"
                  onClick={() => onDelete(gallery.id)}
                >
                  Delete {gallery.name}
                </button>
              ) : (
                <button
                  type="button"
                  className="saved-prompt-edit"
                  aria-label={`Delete ${gallery.name}`}
                  onClick={() => setConfirm(true)}
                >
                  <TrashIcon />
                  Delete
                </button>
              )}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

type Playing = {
  id: string;
  src: string;
  name: string;
};

function GalleryAudioPop({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
  }, [onClose]);

  return createPortal(
    <div className="gallery-audio-pop" ref={ref} role="dialog" aria-label={name}>
      <audio src={src} controls autoPlay />
      <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
        ×
      </button>
    </div>,
    document.body,
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M9.2 3.1 12.9 6.8M3 13l.8-3.1L11.4 2.3a1.1 1.1 0 0 1 1.6 0l.7.7a1.1 1.1 0 0 1 0 1.6L5.1 12.2 3 13z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
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

function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.2v9.6L13 8 5 3.2z" fill="currentColor" />
    </svg>
  );
}

function itemAttached(item: GalleryDraftItem, keys: ReadonlySet<string> | undefined): boolean {
  if (!keys) return false;
  if (item.key && keys.has(item.key)) return true;
  return Boolean(item.url && keys.has(item.url));
}

function AttachIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M6.2 8.6 9.4 5.4a2.1 2.1 0 0 1 3 3L8.2 12.6a3.2 3.2 0 0 1-4.5-4.5l4.4-4.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AttachedIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.4 8.2 6.5 11.3 12.6 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FeatureIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2.4 9.5 6h3.7L10.6 8.3l1.2 3.6L8 9.6 4.2 11.9l1.2-3.6L2.8 6H6.5L8 2.4z"
        fill="currentColor"
      />
    </svg>
  );
}
