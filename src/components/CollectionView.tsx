import { useRef, useState } from "react";
import type { GallerySummary } from "../lib/api";
import { collectionGalleries, galleryChoices, type CollectionTab } from "../lib/collection-view";
import { GALLERY_CARD_DRAG_TYPE, collectionCountLabel, stepCollection } from "../lib/collections";
import type { HistoryGalleryItem, HistoryGalleryNotice } from "../lib/gallery-history";
import { moveItem } from "../lib/mentions";
import type { SlotAddItem, SlotAddNotice, SlotChoice } from "../lib/slot-add";
import { useTileReorder } from "../lib/tile-reorder";
import type { CollectionViewControls } from "../lib/use-collection-view";
import { usePopClose } from "../lib/use-pop-close";
import { CollectionAssets } from "./CollectionAssets";
import { GalleryCard } from "./GalleryBrowser";
import { Loader } from "./Loader";

type Props = {
  view: CollectionViewControls;
  summaries: GallerySummary[];
  onOpenGallery: (id: string) => void;
  onRenameGallery: (id: string, name: string) => void;
  onDeleteGallery: (id: string) => void;
  onAddToGallery: (galleryId: string, items: HistoryGalleryItem[]) => Promise<HistoryGalleryNotice>;
  onCreateGallery: (name: string, items: HistoryGalleryItem[]) => Promise<HistoryGalleryNotice>;
  slotChoices: SlotChoice[];
  onAddToSlot: (slotId: string, items: SlotAddItem[]) => Promise<SlotAddNotice>;
  onCreateSlot: (name: string, items: SlotAddItem[]) => Promise<SlotAddNotice>;
};

const TABS: { id: CollectionTab; label: string }[] = [
  { id: "galleries", label: "Galleries" },
  { id: "assets", label: "All assets" },
];

/** An opened collection: its head, then its galleries as tiles or every file in them. */
export function CollectionView(props: Props) {
  const { view } = props;
  const { collection, controls } = view;
  const galleries = collectionGalleries(controls.collections, props.summaries, collection.id);
  const [attachNote, setAttachNote] = useState<string | null>(null);

  return (
    <div className="gallery-browser collection-view" aria-label="Collection">
      <div className="collection-view-head">
        <button type="button" className="ghost-btn" onClick={view.onClose}>
          Galleries
        </button>
        <CollectionName
          key={collection.id}
          name={collection.name}
          onRename={(name) => controls.onRename(collection.id, name)}
        />
        <span className="collection-view-count">{collectionCountLabel(galleries.length, collection.itemCount)}</span>
        <DeleteCollection
          onDelete={async () => {
            const ok = await controls.onDelete(collection.id);
            if (ok) view.onClose();
          }}
        />
      </div>
      <div className="history-kind collection-tabs" role="tablist" aria-label="Collection view">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={view.tab === tab.id}
            className={`ghost-btn${view.tab === tab.id ? " active" : ""}`}
            onClick={() => {
              setAttachNote(null);
              view.onTab(tab.id);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {controls.status ? <p className="gallery-status">{controls.status}</p> : null}
      {view.tab === "galleries" ? (
        <CollectionTiles
          view={view}
          galleries={galleries}
          summaries={props.summaries}
          onOpenGallery={props.onOpenGallery}
          onRenameGallery={props.onRenameGallery}
          onDeleteGallery={props.onDeleteGallery}
        />
      ) : (
        <>
          {attachNote ? (
            <p className="gallery-status" role="status">
              {attachNote}
            </p>
          ) : null}
          <CollectionAssets
            collectionId={collection.id}
            summaries={props.summaries}
            onOpenGallery={props.onOpenGallery}
            onDownload={view.onDownload}
            onAttach={(items) => setAttachNote(view.onAttach(items))}
            onClear={() => setAttachNote(null)}
            onAddToGallery={props.onAddToGallery}
            onCreateGallery={props.onCreateGallery}
            slotChoices={props.slotChoices}
            onAddToSlot={props.onAddToSlot}
            onCreateSlot={props.onCreateSlot}
            onDeleteFiles={view.onDeleteFiles}
            onDeleted={(keys) => view.onDeleted(keys)}
            onDragItem={view.onAssetDrag}
          />
        </>
      )}
    </div>
  );
}

/** The Galleries tab: tiles in saved order, dragged into a new order, and Add galleries. */
function CollectionTiles({
  view,
  galleries,
  summaries,
  onOpenGallery,
  onRenameGallery,
  onDeleteGallery,
}: {
  view: CollectionViewControls;
  galleries: GallerySummary[];
  summaries: GallerySummary[];
  onOpenGallery: (id: string) => void;
  onRenameGallery: (id: string, name: string) => void;
  onDeleteGallery: (id: string) => void;
}) {
  const { collection, controls } = view;
  const ids = galleries.map((gallery) => gallery.id);
  const saveOrder = (next: string[] | null) => {
    if (next) void controls.onOrderGalleries(collection.id, next);
  };
  // The card's own drag type: the prompt and an open gallery ignore it.
  const reorder = useTileReorder({
    items: galleries,
    dragType: GALLERY_CARD_DRAG_TYPE,
    onReorder: (from, to) => saveOrder(moveItem([...ids], from, to)),
  });

  return (
    <>
      <div className="collection-view-tools">
        <AddGalleries view={view} summaries={summaries} />
      </div>
      {galleries.length === 0 ? (
        <p className="collection-empty">No galleries yet. Add galleries to file them here.</p>
      ) : (
        <div className="collection-tile-grid" {...reorder.set}>
          {galleries.map((gallery, index) => (
            <GalleryCard
              key={gallery.id}
              gallery={gallery}
              collections={controls}
              tile={{
                drag: reorder.tile(index, gallery),
                order: {
                  first: index === 0,
                  last: index === galleries.length - 1,
                  onStep: (step) => saveOrder(stepCollection(ids, gallery.id, step)),
                },
              }}
              onOpen={onOpenGallery}
              onRename={onRenameGallery}
              onDelete={onDeleteGallery}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** A checklist of the profile's other galleries. One filed elsewhere says where, since adding it here moves it. */
function AddGalleries({ view, summaries }: { view: CollectionViewControls; summaries: GallerySummary[] }) {
  const { collection, controls } = view;
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const choices = galleryChoices(controls.collections, summaries, collection.id);
  usePopClose(open && !pending, ref, () => {
    setOpen(false);
    setPicked([]);
  });

  async function add() {
    const chosen = choices.filter((choice) => picked.includes(choice.gallery.id));
    if (pending || chosen.length === 0) return;
    setPending(true);
    let failed = false;
    // One at a time, in list order, so each lands at the end in the order shown.
    for (const choice of chosen) {
      if (!(await controls.onFile(choice.gallery.id, collection.id))) failed = true;
    }
    setPending(false);
    setPicked([]);
    if (!failed) setOpen(false);
  }

  return (
    <div className="collection-add" ref={ref}>
      <button
        type="button"
        className="ghost-btn"
        aria-expanded={open}
        onClick={() => {
          setPicked([]);
          setOpen((value) => !value);
        }}
      >
        Add galleries
      </button>
      {open ? (
        <div className="collection-add-pop history-gallery-pop" role="dialog" aria-label="Add galleries">
          {choices.length === 0 ? (
            <p className="history-gallery-note">Every gallery is already in this collection.</p>
          ) : (
            <div className="history-gallery-choices collection-add-list">
              {choices.map((choice) => (
                <label key={choice.gallery.id} className="collection-add-choice">
                  <input
                    type="checkbox"
                    checked={picked.includes(choice.gallery.id)}
                    disabled={pending}
                    onChange={() =>
                      setPicked((current) =>
                        current.includes(choice.gallery.id)
                          ? current.filter((id) => id !== choice.gallery.id)
                          : [...current, choice.gallery.id],
                      )
                    }
                  />
                  <span className="collection-add-name">{choice.gallery.name}</span>
                  {choice.filedIn ? <span className="collection-add-home">In {choice.filedIn}</span> : null}
                </label>
              ))}
            </div>
          )}
          <button
            type="button"
            className="prompt-action"
            disabled={pending || picked.length === 0}
            onClick={() => void add()}
          >
            {pending ? <Loader size="sm" label="Adding…" /> : picked.length > 1 ? `Add ${picked.length}` : "Add"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The name in an editable field. It saves on Enter or when the field loses focus; Escape puts it back. */
function CollectionName({ name, onRename }: { name: string; onRename: (name: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(name);
  const [shownName, setShownName] = useState(name);
  const skip = useRef(false);

  // A rename from elsewhere (or another collection opened) resets the field, without an effect.
  if (shownName !== name) {
    setShownName(name);
    setDraft(name);
  }

  async function commit() {
    const next = draft.trim();
    if (!next || next === name) {
      setDraft(name);
      return;
    }
    if (!(await onRename(next))) setDraft(name);
  }

  return (
    <input
      className="field collection-view-name"
      value={draft}
      maxLength={80}
      placeholder="Collection name"
      aria-label="Collection name"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (skip.current) {
          skip.current = false;
          return;
        }
        void commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          skip.current = true;
          setDraft(name);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** The same two-step button as Delete gallery. */
function DeleteCollection({ onDelete }: { onDelete: () => Promise<void> }) {
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!confirm) {
    return (
      <button
        type="button"
        className="ghost-btn"
        title="Deletes this collection. Its galleries and files stay."
        onClick={() => setConfirm(true)}
      >
        Delete collection
      </button>
    );
  }
  return (
    <button
      type="button"
      className="ghost-btn gallery-delete"
      title="Deletes this collection. Its galleries and files stay."
      disabled={deleting}
      onClick={() => {
        setDeleting(true);
        void onDelete().finally(() => {
          setDeleting(false);
          setConfirm(false);
        });
      }}
    >
      {deleting ? <Loader size="sm" label="Deleting…" /> : "Delete this collection"}
    </button>
  );
}
