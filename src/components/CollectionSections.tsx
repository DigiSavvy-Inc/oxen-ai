import { useEffect, useRef, useState, type DragEvent, type ReactNode, type RefObject } from "react";
import type { GallerySummary, StudioCollection } from "../lib/api";
import {
  COLLECTION_DRAG_TYPE,
  GALLERY_CARD_DRAG_TYPE,
  collectionCountLabel,
  dragOffers,
  groupGalleries,
} from "../lib/collections";
import type { CollectionControls } from "../lib/use-collections";
import { GalleryThumb } from "./GalleryThumb";
import { Loader } from "./Loader";

type Props = {
  controls: CollectionControls;
  summaries: GallerySummary[];
  renderCard: (gallery: GallerySummary) => ReactNode;
};

/** The Galleries list grouped by collection, with ungrouped galleries below. */
export function CollectionSections({ controls, summaries, renderCard }: Props) {
  const { sections, ungrouped } = groupGalleries(controls.collections, summaries);
  const grouped = sections.length > 0;
  const drop = useDropTarget((event) => {
    const id = event.dataTransfer.getData(GALLERY_CARD_DRAG_TYPE);
    if (id) void controls.onFile(id, null);
  }, [GALLERY_CARD_DRAG_TYPE]);

  return (
    <div className="collection-list">
      <NewCollectionRow onCreate={controls.onCreate} />
      {controls.status ? <p className="gallery-status">{controls.status}</p> : null}
      {sections.map((section, index) => (
        <CollectionSection
          key={section.collection.id}
          collection={section.collection}
          galleries={section.galleries}
          first={index === 0}
          last={index === sections.length - 1}
          folded={controls.folded.has(section.collection.id)}
          controls={controls}
          renderCard={renderCard}
        />
      ))}
      <div
        className={`collection-ungrouped${drop.hot ? " is-drop-hot" : ""}`}
        aria-label={grouped ? "Ungrouped" : undefined}
        {...drop.handlers}
      >
        {grouped ? <h3 className="collection-ungrouped-head">Ungrouped</h3> : null}
        {ungrouped.length > 0 ? (
          <div className="gallery-card-list">{ungrouped.map((gallery) => renderCard(gallery))}</div>
        ) : grouped ? (
          <p className="collection-empty">Every gallery is in a collection.</p>
        ) : (
          <div className="history-empty">No galleries yet. Create one, then pick library tiles.</div>
        )}
      </div>
    </div>
  );
}

function CollectionSection({
  collection,
  galleries,
  first,
  last,
  folded,
  controls,
  renderCard,
}: {
  collection: StudioCollection;
  galleries: GallerySummary[];
  first: boolean;
  last: boolean;
  folded: boolean;
  controls: CollectionControls;
  renderCard: (gallery: GallerySummary) => ReactNode;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(collection.name);
  const drop = useDropTarget(
    (event) => {
      const gallery = event.dataTransfer.getData(GALLERY_CARD_DRAG_TYPE);
      if (gallery) {
        void controls.onFile(gallery, collection.id);
        return;
      }
      const moved = event.dataTransfer.getData(COLLECTION_DRAG_TYPE);
      if (moved) controls.onDropOn(moved, collection.id);
    },
    [GALLERY_CARD_DRAG_TYPE, COLLECTION_DRAG_TYPE],
  );
  const count = collectionCountLabel(galleries.length, collection.itemCount);
  const coverUrl = collection.cover?.thumbUrl ?? null;

  async function rename() {
    const name = draft.trim();
    if (!name || name === collection.name) {
      setRenaming(false);
      return;
    }
    if (await controls.onRename(collection.id, name)) setRenaming(false);
  }

  return (
    <section
      className={`collection-section${drop.hot ? " is-drop-hot" : ""}${folded ? " is-folded" : ""}`}
      aria-label={collection.name}
      {...drop.handlers}
    >
      <div
        className="collection-head"
        draggable={!renaming}
        onDragStart={(event) => {
          if ((event.target as HTMLElement).closest("input, .collection-menu-pop")) {
            event.preventDefault();
            return;
          }
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(COLLECTION_DRAG_TYPE, collection.id);
        }}
      >
        <button
          type="button"
          className="collection-fold"
          aria-expanded={!folded}
          aria-label={`${folded ? "Show" : "Fold"} ${collection.name}`}
          onClick={() => controls.onToggleFold(collection.id)}
        >
          <ChevronIcon />
        </button>
        <span className="collection-cover" aria-hidden="true">
          {coverUrl ? (
            <GalleryThumb kind={collection.cover?.kind ?? "image"} name={collection.name} preview={coverUrl} slot="strip" />
          ) : null}
        </span>
        {renaming ? (
          <form
            className="collection-rename"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <input
              className="field"
              value={draft}
              maxLength={80}
              aria-label="Collection name"
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                event.stopPropagation();
                setDraft(collection.name);
                setRenaming(false);
              }}
            />
            <button type="submit" className="prompt-action" disabled={!draft.trim()}>
              Save
            </button>
          </form>
        ) : (
          <span className="collection-title">
            <span className="collection-name">{collection.name}</span>
            <span className="collection-count">{count}</span>
          </span>
        )}
        <CollectionMenu
          collection={collection}
          first={first}
          last={last}
          onRename={() => {
            setDraft(collection.name);
            setRenaming(true);
          }}
          onStep={(step) => controls.onStep(collection.id, step)}
          onDelete={() => controls.onDelete(collection.id)}
        />
      </div>
      {folded ? null : galleries.length === 0 ? (
        <p className="collection-empty">No galleries yet. Drag one here.</p>
      ) : (
        <div className="gallery-card-list">{galleries.map((gallery) => renderCard(gallery))}</div>
      )}
    </section>
  );
}

function CollectionMenu({
  collection,
  first,
  last,
  onRename,
  onStep,
  onDelete,
}: {
  collection: StudioCollection;
  first: boolean;
  last: boolean;
  onRename: () => void;
  onStep: (step: -1 | 1) => void;
  onDelete: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  usePopClose(open, ref, () => {
    setOpen(false);
    setConfirm(false);
  });

  function close() {
    setOpen(false);
    setConfirm(false);
  }

  return (
    <div className="collection-menu" ref={ref}>
      <button
        type="button"
        className="collection-menu-btn"
        aria-label={`${collection.name} options`}
        aria-expanded={open}
        onClick={() => {
          setConfirm(false);
          setOpen((value) => !value);
        }}
      >
        <MoreIcon />
      </button>
      {open ? (
        <div className="collection-menu-pop history-gallery-pop" role="menu" aria-label={`${collection.name} options`}>
          <button
            type="button"
            role="menuitem"
            className="history-gallery-choice"
            onClick={() => {
              close();
              onRename();
            }}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="history-gallery-choice"
            disabled={first}
            onClick={() => {
              close();
              onStep(-1);
            }}
          >
            Move up
          </button>
          <button
            type="button"
            role="menuitem"
            className="history-gallery-choice"
            disabled={last}
            onClick={() => {
              close();
              onStep(1);
            }}
          >
            Move down
          </button>
          {confirm ? (
            <>
              <p className="history-gallery-note">Deletes this collection. Its galleries and files stay.</p>
              <button
                type="button"
                role="menuitem"
                className="history-gallery-choice gallery-delete"
                disabled={deleting}
                onClick={() => {
                  setDeleting(true);
                  void onDelete().then((ok) => {
                    setDeleting(false);
                    if (ok) close();
                  });
                }}
              >
                {deleting ? <Loader size="sm" label="Deleting…" /> : "Delete this collection"}
              </button>
            </>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="history-gallery-choice"
              title="Deletes this collection. Its galleries and files stay."
              onClick={() => setConfirm(true)}
            >
              Delete collection
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function NewCollectionRow({ onCreate }: { onCreate: (name: string) => Promise<StudioCollection | null> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  if (!open) {
    return (
      <div className="collection-new">
        <button type="button" className="ghost-btn collection-new-btn" onClick={() => setOpen(true)}>
          <PlusIcon />
          New collection
        </button>
      </div>
    );
  }

  return (
    <form
      className="collection-new"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || !name.trim()) return;
        setPending(true);
        void onCreate(name).then((made) => {
          setPending(false);
          if (!made) return;
          setName("");
          setOpen(false);
        });
      }}
    >
      <input
        className="field"
        value={name}
        maxLength={80}
        placeholder="Collection name"
        aria-label="New collection name"
        autoFocus
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          setName("");
          setOpen(false);
        }}
      />
      <button type="submit" className="ghost-btn" disabled={pending || !name.trim()}>
        {pending ? <Loader size="sm" label="Creating…" /> : "Create"}
      </button>
      <button
        type="button"
        className="ghost-btn"
        onClick={() => {
          setName("");
          setOpen(false);
        }}
      >
        Cancel
      </button>
    </form>
  );
}

/** Move to collection on a gallery card: each collection, New collection, and No collection. */
export function MoveToCollection({ gallery, controls }: { gallery: GallerySummary; controls: CollectionControls }) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const current = gallery.collectionId ?? null;
  const label = `Move ${gallery.name} to collection`;
  usePopClose(open, ref, () => {
    setOpen(false);
    setNaming(false);
  });

  async function file(target: string | null) {
    if (pending) return;
    setPending(target ?? "none");
    const ok = await controls.onFile(gallery.id, target);
    setPending(null);
    if (ok) setOpen(false);
  }

  async function fileNew() {
    if (pending || !name.trim()) return;
    setPending("new");
    const ok = await controls.onFileNew(gallery.id, name);
    setPending(null);
    if (!ok) return;
    setName("");
    setNaming(false);
    setOpen(false);
  }

  return (
    <span className="collection-move" ref={ref}>
      <button
        type="button"
        className="saved-prompt-edit"
        aria-label={label}
        aria-expanded={open}
        title="Move to collection"
        onClick={() => {
          setNaming(false);
          setOpen((value) => !value);
        }}
      >
        <FolderIcon />
        Move
      </button>
      {open ? (
        <div className="collection-move-pop history-gallery-pop" role="menu" aria-label={label}>
          <div className="history-gallery-choices">
            {controls.collections.map((collection) => {
              const here = collection.id === current;
              return (
                <button
                  key={collection.id}
                  type="button"
                  role="menuitem"
                  className={`history-gallery-choice${here ? " is-done" : ""}`}
                  disabled={here || Boolean(pending)}
                  onClick={() => void file(collection.id)}
                >
                  <span className="history-gallery-choice-name">{collection.name}</span>
                  {here ? <span className="history-gallery-choice-status">Here</span> : null}
                  {pending === collection.id ? <Loader size="sm" /> : null}
                </button>
              );
            })}
          </div>
          {naming ? (
            <form
              className="history-slot-new"
              onSubmit={(event) => {
                event.preventDefault();
                void fileNew();
              }}
            >
              <input
                className="field"
                value={name}
                maxLength={80}
                placeholder="Collection name"
                aria-label="New collection name"
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
              <button type="submit" className="prompt-action" disabled={Boolean(pending) || !name.trim()}>
                {pending === "new" ? <Loader size="sm" /> : "Create"}
              </button>
            </form>
          ) : (
            <button
              type="button"
              role="menuitem"
              className="history-gallery-choice"
              disabled={Boolean(pending)}
              onClick={() => setNaming(true)}
            >
              New collection…
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="history-gallery-choice"
            disabled={current === null || Boolean(pending)}
            onClick={() => void file(null)}
          >
            <span className="history-gallery-choice-name">No collection</span>
            {pending === "none" ? <Loader size="sm" /> : null}
          </button>
        </div>
      ) : null}
    </span>
  );
}

/** Lights up while an accepted drag is over it, and hands the drop over. */
function useDropTarget(onDrop: (event: DragEvent<HTMLElement>) => void, types: readonly string[]) {
  const [hot, setHot] = useState(false);
  const offered = (event: DragEvent<HTMLElement>) =>
    types.some((type) => dragOffers(event.dataTransfer.types, type));
  return {
    hot,
    handlers: {
      onDragOver(event: DragEvent<HTMLElement>) {
        if (!offered(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        if (!hot) setHot(true);
      },
      onDragLeave(event: DragEvent<HTMLElement>) {
        if (!offered(event)) return;
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setHot(false);
      },
      onDrop(event: DragEvent<HTMLElement>) {
        if (!offered(event)) return;
        event.preventDefault();
        event.stopPropagation();
        setHot(false);
        onDrop(event);
      },
    },
  };
}

/** Closes a small menu on a press outside it or on Escape. */
function usePopClose(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) closeRef.current();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, ref]);
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M2.5 4.5a1 1 0 0 1 1-1h3l1.4 1.5h4.6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
