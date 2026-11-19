import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { normalizeMediaRole, referenceRoleLabel } from "../../worker/schema";
import {
  api,
  type CollectionAsset,
  type CollectionAssetsPage,
  type GallerySummary,
  type LibraryMediaFilter,
} from "../lib/api";
import {
  assetDraftItems,
  assetGalleryCaption,
  assetGalleryItems,
  assetPageCount,
  assetSlides,
  assetOrder,
  assetSlotItems,
  deleteFilesInBatches,
  emptyAssetsMessage,
  pickedInOrder,
  togglePickedAssets,
  type DeleteFilesRequest,
  type PickedAsset,
} from "../lib/collection-assets";
import { GALLERY_ITEM_DRAG_TYPE } from "../lib/gallery-attach";
import type { GalleryDraftItem } from "../lib/gallery-draft";
import type { HistoryGalleryItem, HistoryGalleryNotice } from "../lib/gallery-history";
import { deleteOutcome, type DeleteOutcome, type DeleteScope } from "../lib/media-delete";
import { MEDIA_FILTERS } from "../lib/media-filters";
import { referenceRoleTitle } from "../lib/reference-roles";
import type { SlotAddItem, SlotAddNotice, SlotChoice } from "../lib/slot-add";
import { DeleteMenu } from "./DeleteMenu";
import { FullSizeMedia } from "./FullSizeMedia";
import { RoleGlyph } from "./GalleryRoleSelect";
import { GalleryThumb } from "./GalleryThumb";
import { HistoryGalleryActions } from "./HistoryGalleryActions";
import { Loader } from "./Loader";
import { SlotAddActions } from "./SlotAddActions";

export type CollectionAssetsProps = {
  collectionId: string;
  /** A page already in hand. It is shown at once and the first load is skipped. */
  initialPage?: CollectionAssetsPage;
  /** Galleries for the Add to gallery menu. */
  summaries: GallerySummary[];
  onOpenGallery: (galleryId: string) => void;
  /** Downloads the ticked files, in the order shown. Download is left out without it. */
  onDownload?: (assets: CollectionAsset[]) => Promise<void> | void;
  /** Attaches the ticked files in the order shown. Skipping what the model cannot take is the caller's. */
  onAttach?: (items: GalleryDraftItem[]) => void;
  onAddToGallery: (galleryId: string, items: HistoryGalleryItem[]) => Promise<HistoryGalleryNotice>;
  onCreateGallery: (name: string, items: HistoryGalleryItem[]) => Promise<HistoryGalleryNotice>;
  slotChoices: SlotChoice[];
  onAddToSlot: (slotId: string, items: SlotAddItem[]) => Promise<SlotAddNotice>;
  onCreateSlot: (name: string, items: SlotAddItem[]) => Promise<SlotAddNotice>;
  /** One delete request of at most 96 keys. The view sends a larger selection in batches. */
  onDeleteFiles?: DeleteFilesRequest;
  /** After a delete, with every key that was asked for and the one notice shown. */
  onDeleted?: (keys: string[], outcome: DeleteOutcome) => void;
  /** After Clear drops every tick, on every page. */
  onClear?: () => void;
  /** A tile is being dragged toward the prompt (the item), or the drag ended (null). */
  onDragItem?: (item: GalleryDraftItem | null) => void;
};

type Playing = { key: string; src: string; name: string };

/** All assets of one collection: every file across its galleries, a page at a time. */
export function CollectionAssets(props: CollectionAssetsProps) {
  const { collectionId, initialPage } = props;
  const [media, setMedia] = useState<LibraryMediaFilter>(initialPage?.media ?? "");
  const [page, setPage] = useState(initialPage?.page ?? 1);
  const [data, setData] = useState<CollectionAssetsPage | null>(initialPage ?? null);
  const [loading, setLoading] = useState(!initialPage);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [picked, setPicked] = useState<PickedAsset[]>([]);
  const [note, setNote] = useState<DeleteOutcome | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fitKey, setFitKey] = useState<string | null>(null);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const skipLoad = useRef(Boolean(initialPage));
  const shownId = useRef(collectionId);

  useEffect(() => {
    if (shownId.current === collectionId) return;
    shownId.current = collectionId;
    setMedia("");
    setPage(1);
    setData(null);
    setPicked([]);
    setNote(null);
    setFitKey(null);
    setPlaying(null);
  }, [collectionId]);

  useEffect(() => {
    if (skipLoad.current) {
      skipLoad.current = false;
      return;
    }
    let live = true;
    setLoading(true);
    setLoadError(null);
    api
      .collectionAssets(collectionId, { media, page })
      .then((next) => {
        if (!live) return;
        const last = assetPageCount(next.total, next.pageSize);
        // A delete can leave the page past the end. Step back to the last page.
        if (next.assets.length === 0 && next.total > 0 && page > last) {
          setPage(last);
          return;
        }
        setData(next);
      })
      .catch((err: unknown) => {
        if (live) setLoadError(err instanceof Error ? err.message : "Couldn’t load these files.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [collectionId, media, page, reloadToken]);

  const assets = useMemo(() => data?.assets ?? [], [data]);
  const pageEntries = useMemo<PickedAsset[]>(
    () =>
      data ? data.assets.map((asset, index) => ({ asset, order: assetOrder(data.page, data.pageSize, index) })) : [],
    [data],
  );
  const pickedKeys = useMemo(() => new Set(picked.map((entry) => entry.asset.key)), [picked]);
  // Ticks stay across pages, so a selection can be larger than one page.
  const chosen = useMemo(() => pickedInOrder(picked), [picked]);
  const pageSelected = pageEntries.length > 0 && pageEntries.every((entry) => pickedKeys.has(entry.asset.key));
  const pageCount = data ? assetPageCount(data.total, data.pageSize) : 1;
  const slides = useMemo(() => assetSlides(assets), [assets]);
  const fit = slides.find((slide) => slide.id === fitKey) ?? null;

  function changeMedia(next: LibraryMediaFilter) {
    if (next === media) return;
    setMedia(next);
    setPage(1);
    setPicked([]);
    setNote(null);
  }

  function changePage(next: number) {
    const clamped = Math.min(pageCount, Math.max(1, next));
    if (clamped === page) return;
    setPage(clamped);
    setNote(null);
  }

  function toggle(entry: PickedAsset) {
    setNote(null);
    setPicked((current) => togglePickedAssets(current, [entry]));
  }

  function togglePage() {
    setNote(null);
    setPicked((current) => togglePickedAssets(current, pageEntries, !pageSelected));
  }

  function clearPicked() {
    setNote(null);
    setPicked([]);
    props.onClear?.();
  }

  async function downloadPicked() {
    const download = props.onDownload;
    if (!download || downloading || chosen.length === 0) return;
    setDownloading(true);
    try {
      await download(chosen);
    } finally {
      setDownloading(false);
    }
  }

  async function deletePicked(scope: DeleteScope) {
    const send = props.onDeleteFiles;
    const keys = chosen.map((asset) => asset.key);
    if (!send || deleting || keys.length === 0) return;
    setDeleting(true);
    setNote(null);
    try {
      const result = await deleteFilesInBatches(keys, scope, send);
      const outcome = deleteOutcome(result);
      setNote(outcome);
      setPicked([]);
      // Only files that actually left Studio come out of the other views; a failed batch stays.
      if (result.removedKeys.length > 0) props.onDeleted?.(result.removedKeys, outcome);
    } finally {
      setDeleting(false);
      setReloadToken((value) => value + 1);
    }
  }

  function openAsset(asset: CollectionAsset) {
    if (asset.kind === "audio") {
      setFitKey(null);
      setPlaying({ key: asset.key, src: asset.url, name: asset.name });
      return;
    }
    setPlaying(null);
    flushSync(() => setFitKey(asset.key));
    if (asset.kind !== "video") return;
    const video = document.querySelector(".fullsize-backdrop video[controls]");
    if (video instanceof HTMLVideoElement) void video.play().catch(() => {});
  }

  return (
    <div className="gallery-browser collection-assets" aria-label="All assets">
      <div className="collection-assets-filter">
        <div className="history-kind" role="radiogroup" aria-label="Media type">
          {MEDIA_FILTERS.map((filter) => (
            <button
              key={filter.id || "all"}
              type="button"
              role="radio"
              aria-checked={media === filter.id}
              className={`ghost-btn${media === filter.id ? " active" : ""}`}
              onClick={() => changeMedia(filter.id)}
            >
              {filter.label}
            </button>
          ))}
          {pageEntries.length > 0 ? (
            <button type="button" className="ghost-btn" onClick={togglePage}>
              {pageSelected ? "Clear page" : "Select page"}
            </button>
          ) : null}
        </div>
      </div>

      {chosen.length > 0 ? (
        <CollectionAssetsBar
          count={chosen.length}
          downloading={downloading}
          deleting={deleting}
          onDownload={props.onDownload ? () => void downloadPicked() : undefined}
          onAttach={props.onAttach ? () => props.onAttach?.(assetDraftItems(chosen)) : undefined}
          onClear={clearPicked}
          galleryItems={assetGalleryItems(chosen)}
          summaries={props.summaries}
          onAddToGallery={props.onAddToGallery}
          onCreateGallery={props.onCreateGallery}
          slotItems={assetSlotItems(chosen)}
          slotChoices={props.slotChoices}
          onAddToSlot={props.onAddToSlot}
          onCreateSlot={props.onCreateSlot}
          onDelete={props.onDeleteFiles ? (scope) => void deletePicked(scope) : undefined}
        />
      ) : null}

      {note ? (
        <p className={`collection-assets-note${note.tone === "warn" ? " is-warn" : ""}`} role="status">
          {note.text}
        </p>
      ) : null}

      {loadError && data ? (
        <p className="collection-assets-note is-warn" role="status">
          {loadError}
        </p>
      ) : null}

      {loading && !data ? (
        <div className="history-empty">
          <Loader size="md" label="Loading files…" />
        </div>
      ) : loadError && !data ? (
        <div className="history-empty">{loadError}</div>
      ) : assets.length === 0 ? (
        <div className="history-empty">{emptyAssetsMessage(media)}</div>
      ) : (
        <div className={`gallery-manage-grid collection-assets-grid${loading ? " is-loading" : ""}`}>
          {pageEntries.map((entry) => (
            <AssetTile
              key={entry.asset.key}
              asset={entry.asset}
              picked={pickedKeys.has(entry.asset.key)}
              onToggle={() => toggle(entry)}
              onOpen={() => openAsset(entry.asset)}
              onOpenGallery={() => props.onOpenGallery(entry.asset.galleryId)}
              onDragItem={props.onDragItem}
            />
          ))}
        </div>
      )}

      {pageCount > 1 ? (
        <AssetsPager key={page} page={page} pageCount={pageCount} onPage={changePage} />
      ) : null}

      {fit ? (
        <FullSizeMedia
          src={fit.src}
          alt={fit.alt}
          slides={slides}
          mediaType={fit.mediaType}
          autoPlay={fit.mediaType === "video"}
          activeId={fit.id}
          onSlide={setFitKey}
          onClose={() => setFitKey(null)}
        />
      ) : null}
      {playing ? <AssetAudioPop src={playing.src} name={playing.name} onClose={() => setPlaying(null)} /> : null}
    </div>
  );
}

function AssetTile({
  asset,
  picked,
  onToggle,
  onOpen,
  onOpenGallery,
  onDragItem,
}: {
  asset: CollectionAsset;
  picked: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onOpenGallery: () => void;
  onDragItem?: (item: GalleryDraftItem | null) => void;
}) {
  const preview = asset.thumbUrl || asset.url;
  const audio = asset.kind === "audio";
  const role = audio ? null : normalizeMediaRole(asset.role);
  const caption = assetGalleryCaption(asset);
  const draggable = Boolean(onDragItem && asset.url && asset.key);
  return (
    <div
      className={`gallery-manage-tile collection-asset${picked ? " is-selected" : ""}`}
      data-asset-key={asset.key}
    >
      <div className="gallery-manage-frame">
        {asset.url ? (
          <button
            type="button"
            className={`gallery-tile-hit${audio ? " is-audio" : ""}`}
            aria-label={`${audio ? "Play" : "Open"} ${asset.name}`}
            draggable={draggable || undefined}
            onDragStart={
              draggable
                ? (event) => {
                    // The same drag an open gallery's tile makes, so the prompt takes it as one attachment.
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(GALLERY_ITEM_DRAG_TYPE, asset.key);
                    onDragItem?.(assetDraftItems([asset])[0] ?? null);
                  }
                : undefined
            }
            onDragEnd={draggable ? () => onDragItem?.(null) : undefined}
            onClick={onOpen}
          >
            <GalleryThumb kind={asset.kind} name={asset.name} preview={preview} slot="tile" />
          </button>
        ) : (
          <GalleryThumb kind={asset.kind} name={asset.name} preview={preview} slot="tile" />
        )}
        <label className="gallery-select">
          <input type="checkbox" checked={picked} aria-label={`Select ${asset.name}`} onChange={onToggle} />
        </label>
        {role ? (
          <span className="gallery-tile-actions">
            <span
              className={`gallery-role-chip collection-asset-role is-${role}`}
              role="img"
              aria-label={`Role: ${referenceRoleLabel(role)}`}
              title={referenceRoleTitle(role)}
            >
              <RoleGlyph role={role} />
            </span>
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="collection-asset-gallery"
        title={`Open ${asset.galleryName}`}
        aria-label={`Open gallery ${asset.galleryName}`}
        onClick={onOpenGallery}
      >
        {caption}
      </button>
    </div>
  );
}

/** The selection bar: the count, then the same controls as the past-work bar, in its order. */
export function CollectionAssetsBar(props: {
  count: number;
  downloading?: boolean;
  deleting?: boolean;
  onDownload?: () => void;
  onAttach?: () => void;
  onClear: () => void;
  galleryItems: HistoryGalleryItem[];
  summaries: GallerySummary[];
  onAddToGallery: (galleryId: string, items: HistoryGalleryItem[]) => Promise<HistoryGalleryNotice>;
  onCreateGallery: (name: string, items: HistoryGalleryItem[]) => Promise<HistoryGalleryNotice>;
  slotItems: SlotAddItem[];
  slotChoices: SlotChoice[];
  onAddToSlot: (slotId: string, items: SlotAddItem[]) => Promise<SlotAddNotice>;
  onCreateSlot: (name: string, items: SlotAddItem[]) => Promise<SlotAddNotice>;
  onDelete?: (scope: DeleteScope) => void;
}) {
  return (
    <div className="gallery-bulk collection-assets-bar">
      <span className="gallery-bulk-count">{`${props.count} selected`}</span>
      {props.onDownload ? (
        <button type="button" className="ghost-btn" disabled={props.downloading} onClick={props.onDownload}>
          {props.downloading ? "Downloading…" : "Download"}
        </button>
      ) : null}
      {props.onAttach ? (
        <button type="button" className="ghost-btn" onClick={props.onAttach}>
          Attach
        </button>
      ) : null}
      <button type="button" className="ghost-btn" title="Clear the selection" onClick={props.onClear}>
        Clear
      </button>
      <HistoryGalleryActions
        items={props.galleryItems}
        summaries={props.summaries}
        onAdd={props.onAddToGallery}
        onCreate={props.onCreateGallery}
        placement="below"
      />
      <SlotAddActions
        items={props.slotItems}
        slots={props.slotChoices}
        onAdd={props.onAddToSlot}
        onCreate={props.onCreateSlot}
        placement="below"
      />
      {props.onDelete ? (
        <DeleteMenu
          count={props.count}
          disabled={props.deleting}
          label="Delete the selected files"
          onChoose={props.onDelete}
        >
          {props.deleting ? <Loader size="sm" label="Deleting…" /> : "Delete"}
        </DeleteMenu>
      ) : null}
    </div>
  );
}

function AssetsPager({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}) {
  // The caller keys this on the page, so the field starts over when the page changes.
  const [draft, setDraft] = useState(String(page));
  const skipCommit = useRef(false);

  return (
    <nav className="history-pager collection-assets-pager" aria-label="Asset pages">
      <button type="button" className="ghost-btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <label className="history-page-jump">
        <input
          className="history-page-input"
          type="text"
          inputMode="numeric"
          aria-label={`Page ${page} of ${pageCount}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value.replace(/[^\d]/g, ""))}
          onBlur={() => {
            if (skipCommit.current) {
              skipCommit.current = false;
              setDraft(String(page));
              return;
            }
            const next = Number(draft);
            if (!draft || !Number.isFinite(next)) {
              setDraft(String(page));
              return;
            }
            const clamped = Math.min(pageCount, Math.max(1, Math.round(next)));
            setDraft(String(clamped));
            if (clamped !== page) onPage(clamped);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              skipCommit.current = true;
              setDraft(String(page));
              event.currentTarget.blur();
            }
          }}
        />
        <span>of {pageCount}</span>
      </label>
      <button
        type="button"
        className="ghost-btn"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}

/** The small audio player, as an open gallery shows it. */
function AssetAudioPop({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
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
