import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import type { MediaRole } from "../../worker/schema";
import {
  coverGeneration,
  groupGenerationBatches,
  isActiveGeneration,
  isUnfinishedGeneration,
  type GenerationBatch,
} from "../lib/batches";
import type { GallerySummary, Generation, LibraryMediaFilter } from "../lib/api";
import { brandMarkClass } from "../lib/branding";
import {
  completedMedia,
  downloadAllMedia,
  downloadFilename,
  downloadMedia,
  tilePreviewUrl,
} from "../lib/download";
import {
  galleryExpandTransition,
  versionsBesidePreview,
  type GalleryExpandAction,
  type GalleryExpandState,
} from "../lib/gallery-expand";
import type { GalleryDraftItem } from "../lib/gallery-draft";
import {
  historyItemForGallery,
  historyItemsForGallery,
  historyKeySelected,
  type HistoryGalleryItem,
  type HistoryGalleryNotice,
} from "../lib/gallery-history";
import { writeHistoryDrag } from "../lib/history-drag";
import type { DeleteScope } from "../lib/media-delete";
import { prunePicked, selectionInsideGroup, togglePicked } from "../lib/media-selection";
import { runModes } from "../lib/mode-icons";
import { suggestTags } from "../lib/tags";
import { CopyPrompt } from "./CopyPrompt";
import { CreateGalleryPalette } from "./CreateGalleryPalette";
import { GalleryBrowser, type GalleryPlace } from "./GalleryBrowser";
import { DownloadButton } from "./DownloadButton";
import { DeleteMenu, TrashIcon } from "./DeleteMenu";
import { HistoryGalleryActions } from "./HistoryGalleryActions";
import { HistoryGroupBar } from "./HistoryGroupBar";
import { ExpandCorners, FullSizeMedia, type FitSlide } from "./FullSizeMedia";
import { Loader } from "./Loader";
import { PanelPlaceSwitch } from "./PanelPlace";
import { ModelName } from "./ModeIcon";
import { StagedStill, StagedVideo } from "./StagedStill";

function tileSrc(item: Generation, allowFull = false): string | null {
  return tilePreviewUrl(item) || (allowFull ? item.resultUrl : null);
}

function VideoPlayMark() {
  return (
    <span className="history-play" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <path
          fill="currentColor"
          d="M9.5 7.1a1 1 0 0 1 1.52-.85l7.1 4.4a1 1 0 0 1 0 1.7l-7.1 4.4A1 1 0 0 1 9.5 16V7.1z"
        />
      </svg>
    </span>
  );
}

function TileFace({ item, allowFull = false }: { item: Generation; allowFull?: boolean }) {
  const src = tileSrc(item, allowFull);
  if (src && item.mediaType === "image") {
    return <img src={src} alt="" loading="lazy" decoding="async" draggable={false} />;
  }
  if (item.mediaType === "video" && (item.thumbUrl || item.lastFrameUrl)) {
    return (
      <>
        <img
          src={item.thumbUrl || item.lastFrameUrl || ""}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
        />
        <VideoPlayMark />
      </>
    );
  }
  if (item.mediaType === "audio") {
    return <span className="audio-mark">Audio</span>;
  }
  if (isActiveGeneration(item) && !src) {
    return <Loader size="sm" />;
  }
  if (item.mediaType === "video") {
    return (
      <>
        <span>VID</span>
        <VideoPlayMark />
      </>
    );
  }
  return <span>IMG</span>;
}

function PreviewFace({ item }: { item: Generation }) {
  if (item.mediaType === "audio" && item.resultUrl) {
    return <audio className="library-audio" src={item.resultUrl} controls preload="metadata" />;
  }
  if (item.mediaType === "image" && item.resultUrl) {
    return <StagedStill key={item.id} thumb={item.thumbUrl} full={item.resultUrl} alt="" />;
  }
  if (item.mediaType === "video" && item.resultUrl) {
    return (
      <>
        <StagedVideo
          key={item.id}
          src={item.resultUrl}
          poster={item.thumbUrl || item.lastFrameUrl}
          muted
          playsInline
          preload="metadata"
        />
        <VideoPlayMark />
      </>
    );
  }
  return <TileFace item={item} allowFull />;
}

function canOpenFit(item: Generation | null | undefined): boolean {
  return Boolean(
    item &&
      (item.mediaType === "image" || item.mediaType === "video") &&
      item.status === "succeeded" &&
      item.resultUrl,
  );
}

function fitSlides(items: Generation[]): FitSlide[] {
  return items.flatMap((item) => {
    if (!canOpenFit(item) || !item.resultUrl) return [];
    if (item.mediaType !== "image" && item.mediaType !== "video") return [];
    return [
      {
        id: item.id,
        src: item.resultUrl,
        alt: item.prompt || "Library item",
        mediaType: item.mediaType,
        poster: item.thumbUrl || item.lastFrameUrl || null,
      },
    ];
  });
}

function ExpandPrompt({ prompt, model, mode }: { prompt: string; model: string; mode: string }) {
  const [open, setOpen] = useState(false);
  const modelName = model.trim();
  const hasPrompt = prompt.trim().length > 0;
  if (!hasPrompt && !modelName) return null;
  return (
    <div className="history-prompt">
      <div className="history-prompt-row">
        {hasPrompt ? (
          <button
            type="button"
            className="history-prompt-toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide prompt" : "Prompt"}
          </button>
        ) : null}
        {modelName ? (
          <span className="pill history-model-pill" title={modelName} data-model={modelName}>
            <ModelName name={modelName} modes={runModes(mode)} />
          </span>
        ) : null}
      </div>
      {hasPrompt ? (
        <div className={`history-prompt-panel${open ? " is-open" : ""}`}>
          <div className="history-prompt-panel-inner">
            <CopyPrompt prompt={prompt} className="history-prompt-quote" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

const CLOSED_EXPAND: GalleryExpandState = {
  expandedId: null,
  previewId: null,
  fitOpen: false,
};

const GALLERY_COLUMNS = 3;

const MEDIA_FILTERS: { id: LibraryMediaFilter; label: string }[] = [
  { id: "", label: "All" },
  { id: "image", label: "Images" },
  { id: "video", label: "Videos" },
  { id: "audio", label: "Audio" },
];

function mediaFilterLabel(media: LibraryMediaFilter): string {
  return MEDIA_FILTERS.find((item) => item.id === media)?.label.toLowerCase() ?? "media";
}

function emptyLibraryMessage(
  appliedTag: string,
  media: LibraryMediaFilter,
  loadError?: string | null,
): string {
  if (loadError) return loadError;
  const kind = media ? mediaFilterLabel(media) : "";
  if (appliedTag.trim() && kind) return `No ${kind} with that tag.`;
  if (kind) return `No ${kind} yet.`;
  if (appliedTag.trim()) return "No media with that tag.";
  return "No generations yet. Write a prompt and hit Generate — jobs run through Oxen's async queue.";
}

function chunkBatches<T>(items: T[], size = GALLERY_COLUMNS): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

export function Sidebar({
  logoUrl,
  generations,
  selectedId,
  loading,
  loadError,
  downloadingAll,
  tagInput,
  appliedTag,
  allTags,
  onTagInput,
  media = "",
  onMedia,
  page,
  pageCount,
  onPage,
  onSelect,
  onClose,
  onDownloadAll,
  onDelete,
  attachedIds,
  attachedMediaKeys,
  onAttach,
  onClearFailed,
  clearingFailed = false,
  attachSupported,
  createGalleryOpen,
  galleryName,
  onGalleryNameChange,
  galleryItems,
  gallerySaving,
  galleryAdding,
  galleryStatus,
  onGalleryAddFiles,
  onGalleryRemove,
  onCreateGallery,
  onCreateGalleryClose,
  onCreateGallerySave,
  onToggleHistory,
  onDropHistoryMedia,
  galleryAccept,
  galleryDropLabel,
  gallerySummaries,
  galleryId,
  onGalleryOpen,
  onManageGallerySave,
  onGalleryAttach,
  gallerySkipped,
  onGalleryRoleChange,
  onGalleryFeature,
  onGalleryReorder,
  onGalleryTileDrag,
  onGalleryDelete,
  onGalleryRename,
  onGalleryDeleteSelected,
  onGalleryPlace,
  onHistoryAddToGallery,
  onHistoryCreateGallery,
  managingGallery,
  onManagingGallery,
  pane,
  onPaneChange,
}: {
  logoUrl: string;
  generations: Generation[];
  selectedId: string | null;
  loading?: boolean;
  loadError?: string | null;
  downloadingAll?: boolean;
  tagInput: string;
  appliedTag: string;
  allTags: string[];
  onTagInput: (value: string) => void;
  media?: LibraryMediaFilter;
  onMedia?: (value: LibraryMediaFilter) => void;
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
  onSelect: (id: string | null) => void;
  onClose?: () => void;
  onDownloadAll?: () => void;
  onDelete?: (ids: string[], scope: DeleteScope) => void;
  attachedIds?: Set<string>;
  attachedMediaKeys?: ReadonlySet<string>;
  onAttach?: (item: Generation) => void;
  onClearFailed?: () => void;
  clearingFailed?: boolean;
  attachSupported?: (item: Generation) => boolean;
  createGalleryOpen: boolean;
  galleryName: string;
  onGalleryNameChange: (value: string) => void;
  galleryItems: GalleryDraftItem[];
  gallerySaving: boolean;
  galleryAdding: boolean;
  galleryStatus: string | null;
  onGalleryAddFiles: (files: FileList | File[] | null) => void;
  onGalleryRemove: (index: number) => void;
  onCreateGallery: () => void;
  onCreateGalleryClose: () => void;
  onCreateGallerySave: () => void;
  onToggleHistory: (items: Generation[]) => void;
  onDropHistoryMedia: (ids: string[]) => void;
  galleryAccept: string;
  galleryDropLabel: string;
  gallerySummaries: GallerySummary[];
  galleryId: string | null;
  onGalleryOpen: (id: string) => void;
  onManageGallerySave: () => void;
  onGalleryAttach: (items?: GalleryDraftItem[]) => void;
  gallerySkipped: string[];
  onGalleryRoleChange: (index: number, role: MediaRole) => void;
  onGalleryFeature: (index: number) => void;
  onGalleryReorder: (from: number, to: number) => void;
  onGalleryTileDrag: (dragging: boolean) => void;
  onGalleryDelete: (id?: string) => void;
  onGalleryRename: (id: string, name: string) => void;
  onGalleryDeleteSelected: (ids: string[]) => Promise<boolean>;
  onGalleryPlace: (input: GalleryPlace) => Promise<boolean>;
  onHistoryAddToGallery: (galleryId: string, items: HistoryGalleryItem[]) => Promise<HistoryGalleryNotice>;
  onHistoryCreateGallery: (name: string, items: HistoryGalleryItem[]) => Promise<HistoryGalleryNotice>;
  /** True while one gallery is open in the panel; false shows the list of galleries. */
  managingGallery: boolean;
  onManagingGallery: (value: boolean) => void;
  pane: "history" | "galleries";
  onPaneChange: (pane: "history" | "galleries") => void;
}) {
  const pagingKey = `${page}\0${appliedTag}\0${media}`;
  const [pageDraft, setPageDraft] = useState(String(page));
  const pageCommitSkip = useRef(false);
  const galleriesOpen = pane === "galleries";
  const [expandKey, setExpandKey] = useState(pagingKey);
  const [expand, setExpand] = useState<GalleryExpandState>(CLOSED_EXPAND);
  const expandRef = useRef(expand);
  const expandKeyRef = useRef(pagingKey);
  const expandedTileRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const previews = useMemo(() => suggestTags(allTags, tagInput), [allTags, tagInput]);
  const batches = useMemo(() => groupGenerationBatches(generations), [generations]);
  const readyAll = useMemo(() => completedMedia(generations), [generations]);
  const galleryKeySet = useMemo(() => new Set(galleryItems.map((item) => item.key)), [galleryItems]);
  const galleryDetail = galleriesOpen && managingGallery && Boolean(galleryId);
  const suppressHistoryClick = useRef(false);
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);
  const unfinishedCount = useMemo(
    () => generations.filter((item) => isUnfinishedGeneration(item)).length,
    [generations],
  );
  const [picked, setPicked] = useState<string[]>([]);
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const [downloadingPicked, setDownloadingPicked] = useState(false);

  const expandForPage = expandKey === pagingKey ? expand : CLOSED_EXPAND;
  const expandVisible =
    !expandForPage.expandedId || batches.some((batch) => batch.id === expandForPage.expandedId)
      ? expandForPage
      : CLOSED_EXPAND;

  useEffect(() => {
    setPageDraft(String(page));
  }, [page]);

  useEffect(() => {
    if (!expandVisible.expandedId) return;
    expandedTileRef.current?.scrollIntoView({ block: "nearest" });
  }, [expandVisible.expandedId]);

  useEffect(() => {
    expandKeyRef.current = pagingKey;
    expandRef.current = CLOSED_EXPAND;
    setPicked([]);
    setBulkNote(null);
    historyRef.current?.scrollTo({ top: 0 });
  }, [pagingKey]);

  const pageIds = useMemo(() => generations.map((item) => item.id), [generations]);
  /** Ticks for items still listed. A deleted item drops out without waiting for its tick to clear. */
  const livePicked = useMemo(() => prunePicked(picked, pageIds), [picked, pageIds]);
  const pickedItems = useMemo(
    () => generations.filter((item) => livePicked.includes(item.id)),
    [generations, livePicked],
  );
  const pickedReady = useMemo(() => completedMedia(pickedItems), [pickedItems]);
  const pickedDrafts = useMemo(() => historyItemsForGallery(pickedItems), [pickedItems]);
  const pageSelected = pageIds.length > 0 && pageIds.every((id) => livePicked.includes(id));
  const openGroupIds = useMemo(
    () => batches.find((batch) => batch.id === expandVisible.expandedId)?.items.map((item) => item.id) ?? [],
    [batches, expandVisible.expandedId],
  );
  /** Ticks that all sit in the opened group are handled by that group's own bar. */
  const groupOwnsPicks = selectionInsideGroup(openGroupIds, livePicked);

  function toggleIds(ids: string[]) {
    setBulkNote(null);
    setPicked((current) => togglePicked(prunePicked(current, pageIds), ids));
  }

  function pickGroup(ids: string[], on: boolean) {
    setBulkNote(null);
    setPicked((current) => {
      const rest = prunePicked(current, pageIds).filter((id) => !ids.includes(id));
      return on ? [...rest, ...ids] : rest;
    });
  }

  function togglePage() {
    setBulkNote(null);
    setPicked(pageSelected ? [] : pageIds);
  }

  async function downloadPicked() {
    if (pickedReady.length === 0 || downloadingPicked) return;
    setDownloadingPicked(true);
    setBulkNote(null);
    try {
      await downloadAllMedia(pickedReady);
    } finally {
      setDownloadingPicked(false);
    }
  }

  function attachPicked() {
    if (!onAttach) return;
    let attached = 0;
    let skipped = 0;
    for (const item of pickedItems) {
      const ready = Boolean(historyItemForGallery(item));
      const allowed = ready && (attachSupported ? attachSupported(item) : true);
      if (!allowed) {
        skipped += 1;
        continue;
      }
      onAttach(item);
      attached += 1;
    }
    if (attached === 0) {
      setBulkNote(skipped > 0 ? "This model can't take the selected media." : "Nothing ready to attach.");
      return;
    }
    setBulkNote(skipped > 0 ? `Attached ${attached}. Skipped ${skipped}.` : `Attached ${attached}.`);
  }

  function deleteIds(ids: string[], scope: DeleteScope) {
    if (!onDelete || ids.length === 0) return;
    onDelete(ids, scope);
    setPicked((current) => current.filter((id) => !ids.includes(id)));
    setBulkNote(null);
  }

  function notePointer(event: { clientX: number; clientY: number }) {
    pointerOrigin.current = { x: event.clientX, y: event.clientY };
    suppressHistoryClick.current = false;
  }

  function dragMoved(event: { clientX: number; clientY: number }): boolean {
    const origin = pointerOrigin.current;
    if (!origin) return true;
    if (event.clientX === 0 && event.clientY === 0) return false;
    return Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6;
  }

  function rememberHistoryDrag(event: DragEvent<HTMLElement>, items: Generation[]) {
    const ids = historyItemsForGallery(items).map((item) => item.id);
    if (ids.length === 0 || !dragMoved(event)) {
      event.preventDefault();
      suppressHistoryClick.current = false;
      return;
    }
    suppressHistoryClick.current = true;
    writeHistoryDrag(event.dataTransfer, ids);
  }

  function finishHistoryDrag() {
    window.setTimeout(() => {
      suppressHistoryClick.current = false;
    }, 0);
  }

  function historyClick(event: MouseEvent<HTMLElement>, run: () => void) {
    if (!suppressHistoryClick.current) {
      run();
      return;
    }
    event.preventDefault();
    suppressHistoryClick.current = false;
  }

  function commit(action: GalleryExpandAction) {
    const base = expandKeyRef.current === pagingKey ? expandRef.current : CLOSED_EXPAND;
    const next = galleryExpandTransition(base, action);
    expandKeyRef.current = pagingKey;
    expandRef.current = next;
    setExpandKey(pagingKey);
    setExpand(next);
    if (next.peek !== undefined) onSelect(next.peek);
  }

  function batchTile(batch: GenerationBatch) {
    const cover = coverGeneration(batch.items);
    const openId = cover?.id ?? batch.items[0]?.id ?? batch.id;
    const mediaType = batch.items.some((item) => item.mediaType === "video")
      ? "video"
      : (cover?.mediaType ?? null);
    const multi = batch.items.length > 1;
    const expanded = expandVisible.expandedId === batch.id;
    const singleLabel = mediaType === "video" ? "video" : mediaType === "audio" ? "audio" : "image";
    const selected = batch.items.some((item) => item.id === selectedId);
    const inGallery = createGalleryOpen && historyKeySelected(galleryKeySet, batch.items);
    const dragItems = historyItemsForGallery(batch.items);
    const batchIds = batch.items.map((item) => item.id);
    const batchPicked = batchIds.length > 0 && batchIds.every((id) => livePicked.includes(id));
    return (
      <div
        key={batch.id}
        className={`history-tile${selected ? " active" : ""}${expanded ? " is-open" : ""}${inGallery ? " is-gallery" : ""}${batchPicked ? " is-picked" : ""}`}
        data-batch-id={batch.id}
      >
        <div className="history-tile-square">
          <button
            type="button"
            className="history-tile-hit"
            draggable={dragItems.length > 0}
            onPointerDown={notePointer}
            onDragStart={(event) => rememberHistoryDrag(event, batch.items)}
            onDragEnd={finishHistoryDrag}
            aria-expanded={createGalleryOpen ? undefined : expanded}
            aria-pressed={createGalleryOpen ? inGallery : undefined}
            aria-label={
              createGalleryOpen
                ? inGallery
                  ? multi
                    ? `Remove ${batch.items.length} variations from gallery`
                    : `Remove ${singleLabel} from gallery`
                  : multi
                    ? `Add ${batch.items.length} variations to gallery`
                    : `Add ${singleLabel} to gallery`
                : expanded
                  ? multi
                    ? `Collapse ${batch.items.length} variations`
                    : `Collapse ${singleLabel}`
                  : multi
                    ? `${batch.items.length} variations`
                    : `Open ${singleLabel}`
            }
            title={cover?.prompt || "Generation"}
            onClick={(event) => {
              historyClick(event, () => {
                if (createGalleryOpen) {
                  onToggleHistory(batch.items);
                  return;
                }
                commit({
                  type: "tile",
                  batchId: batch.id,
                  count: batch.items.length,
                  openId,
                  mediaType,
                });
              });
            }}
          >
            <div className="history-tile-media">
              {cover ? <TileFace item={cover} /> : null}
            </div>
          </button>
          <label className="gallery-select history-select">
            <input
              type="checkbox"
              checked={batchPicked}
              aria-label={`Select ${multi ? `${batch.items.length} ${singleLabel}s` : singleLabel}`}
              onChange={() => toggleIds(batchIds)}
            />
          </label>
          {inGallery ? (
            <span className="history-gallery-mark" aria-hidden="true">
              ✓
            </span>
          ) : null}
          {multi ? <span className="history-count">{batch.items.length}</span> : null}
          {onDelete ? (
            <DeleteMenu
              className="media-delete"
              count={batchIds.length}
              label={multi ? `Delete ${batchIds.length} ${singleLabel}s` : `Delete ${singleLabel}`}
              onChoose={(scope) => deleteIds(batchIds, scope)}
            >
              <TrashIcon />
            </DeleteMenu>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <aside className="sidebar" id="media-library">
      <div className="sidebar-header">
        <div className="brand">
          <img className={brandMarkClass(logoUrl)} src={logoUrl} alt="" />
          <div className="brand-copy">
            <strong>Library</strong>
            <span>{galleriesOpen ? "Galleries" : "Past work"}</span>
          </div>
        </div>
        <div className="sidebar-header-actions">
          <button
            type="button"
            className={`ghost-btn${galleriesOpen ? " active" : ""}`}
            aria-pressed={galleriesOpen}
            onClick={() => {
              if (createGalleryOpen) onCreateGalleryClose();
              onManagingGallery(false);
              onPaneChange(galleriesOpen ? "history" : "galleries");
            }}
          >
            Galleries
          </button>
          <button
            type="button"
            className={`ghost-btn${createGalleryOpen ? " active" : ""}`}
            aria-expanded={createGalleryOpen}
            aria-controls="create-gallery"
            onClick={() => {
              onPaneChange("history");
              onManagingGallery(false);
              onCreateGallery();
            }}
          >
            Create gallery
          </button>
          {onDownloadAll && readyAll.length > 0 ? (
            <button
              type="button"
              className="ghost-btn"
              disabled={downloadingAll}
              onClick={onDownloadAll}
            >
              {downloadingAll ? (
                <Loader size="sm" label="Downloading…" />
              ) : pageCount > 1 ? (
                "Download page"
              ) : (
                "Download all"
              )}
            </button>
          ) : null}
          <PanelPlaceSwitch />
          {onClose ? (
            <button
              type="button"
              className="icon-btn sidebar-close"
              aria-label="Close library"
              onClick={onClose}
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      {createGalleryOpen ? (
        <CreateGalleryPalette
          name={galleryName}
          onNameChange={onGalleryNameChange}
          items={galleryItems}
          saving={gallerySaving}
          adding={galleryAdding}
          status={galleryStatus}
          accept={galleryAccept}
          dropLabel={galleryDropLabel}
          onAddFiles={onGalleryAddFiles}
          onDropHistory={onDropHistoryMedia}
          onRemove={onGalleryRemove}
          onSave={onCreateGallerySave}
          onClose={onCreateGalleryClose}
        />
      ) : null}

      {galleriesOpen ? (
        <GalleryBrowser
          summaries={gallerySummaries}
          detail={galleryDetail}
          galleryId={galleryId}
          name={galleryName}
          items={galleryItems}
          saving={gallerySaving}
          status={galleryStatus}
          skipped={gallerySkipped}
          onOpen={(id) => {
            onManagingGallery(true);
            onGalleryOpen(id);
          }}
          onBack={() => onManagingGallery(false)}
          onNameChange={onGalleryNameChange}
          onSave={onManageGallerySave}
          onAttach={onGalleryAttach}
          attachedKeys={attachedMediaKeys}
          onRemove={onGalleryRemove}
          onRoleChange={onGalleryRoleChange}
          onFeature={onGalleryFeature}
          onReorder={onGalleryReorder}
          onTileDrag={onGalleryTileDrag}
          onDelete={() => onGalleryDelete()}
          onRenameGallery={onGalleryRename}
          onDeleteGallery={onGalleryDelete}
          onDeleteSelected={onGalleryDeleteSelected}
          onPlaceSelected={onGalleryPlace}
          adding={galleryAdding}
          accept={galleryAccept}
          dropLabel={galleryDropLabel}
          onAddFiles={onGalleryAddFiles}
          onDropHistory={onDropHistoryMedia}
        />
      ) : null}

      {!galleriesOpen ? (
      <>
      <div className="tag-filter">
        <div className="history-kind" role="radiogroup" aria-label="Media type">
          {MEDIA_FILTERS.map((filter) => (
            <button
              key={filter.id || "all"}
              type="button"
              role="radio"
              aria-checked={media === filter.id}
              className={`ghost-btn${media === filter.id ? " active" : ""}`}
              onClick={() => onMedia?.(filter.id)}
            >
              {filter.label}
            </button>
          ))}
          {pageIds.length > 0 ? (
            <button type="button" className="ghost-btn" onClick={togglePage}>
              {pageSelected ? "Clear" : "Select page"}
            </button>
          ) : null}
          {onClearFailed && unfinishedCount > 0 ? (
            <button
              type="button"
              className="ghost-btn"
              disabled={clearingFailed}
              onClick={onClearFailed}
            >
              {clearingFailed ? "Clearing…" : "Clear failed"}
            </button>
          ) : null}
        </div>
        <input
          className="tag-filter-input"
          value={tagInput}
          placeholder="Filter by tag"
          aria-label="Filter by tag"
          onChange={(event) => onTagInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onTagInput("");
            if (event.key === "Enter" && previews[0]) {
              event.preventDefault();
              onTagInput(previews[0]);
            }
          }}
        />
        {previews.length > 0 ? (
          <div className="tag-preview" role="listbox" aria-label="Matching tags">
            {previews.map((tag) => (
              <button
                key={tag.toLowerCase()}
                type="button"
                className={`tag-chip preview${tagInput.trim().toLowerCase() === tag.toLowerCase() ? " active" : ""}`}
                onClick={() => onTagInput(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : tagInput.trim() && allTags.length > 0 ? (
          <div className="tag-preview-empty">No tags match “{tagInput.trim()}”</div>
        ) : null}
      </div>

      {livePicked.length > 0 && !groupOwnsPicks ? (
        <div className="history-bulk">
          <span className="gallery-bulk-count">
            {livePicked.length} selected
          </span>
          <button
            type="button"
            className="ghost-btn"
            disabled={pickedReady.length === 0 || downloadingPicked}
            onClick={() => void downloadPicked()}
          >
            {downloadingPicked ? "Downloading…" : "Download"}
          </button>
          {onAttach ? (
            <button type="button" className="ghost-btn" onClick={attachPicked}>
              Attach
            </button>
          ) : null}
          {pickedDrafts.length > 0 ? (
            <HistoryGalleryActions
              items={pickedDrafts}
              summaries={gallerySummaries}
              onAdd={onHistoryAddToGallery}
              onCreate={onHistoryCreateGallery}
              placement="below"
            />
          ) : null}
          {onDelete ? (
            <DeleteMenu count={livePicked.length} onChoose={(scope) => deleteIds(livePicked, scope)} />
          ) : null}
          {bulkNote ? <span className="history-bulk-note">{bulkNote}</span> : null}
        </div>
      ) : null}

      <div className="history" ref={historyRef}>
        <div className="history-grid">
          {loading && batches.length === 0 ? (
            <div className="history-empty">
              <Loader size="md" label="Loading library…" />
            </div>
          ) : batches.length === 0 ? (
            <div className="history-empty">
              {emptyLibraryMessage(appliedTag, media, loadError)}
            </div>
          ) : (
            chunkBatches(batches).map((row) => {
              const openBatch = row.find((batch) => batch.id === expandVisible.expandedId) ?? null;
              const preview = openBatch
                ? (openBatch.items.find((item) => item.id === expandVisible.previewId) ??
                  openBatch.items[0] ??
                  null)
                : null;
              const readyInGroup = openBatch ? completedMedia(openBatch.items) : [];
              const canFit = canOpenFit(preview);
              return (
                <Fragment key={row.map((batch) => batch.id).join(":")}>
                  {row.map((batch) => batchTile(batch))}
                  {openBatch && preview ? (
                    <div className="history-row-detail" ref={expandedTileRef} key={`${openBatch.id}-detail`}>
                      <div className="history-expand">
                        <div className="history-expand-frame">
                          {canFit ? (
                            <button
                              type="button"
                              className="history-expand-preview"
                              draggable={historyItemsForGallery([preview]).length > 0}
                              onPointerDown={notePointer}
                              onDragStart={(event) => rememberHistoryDrag(event, [preview])}
                              onDragEnd={finishHistoryDrag}
                              aria-label={createGalleryOpen ? "Add preview to gallery" : "View full size"}
                              aria-pressed={
                                createGalleryOpen ? historyKeySelected(galleryKeySet, [preview]) : undefined
                              }
                              data-preview-id={preview.id}
                              onClick={(event) => {
                                historyClick(event, () => {
                                  if (createGalleryOpen) {
                                    onToggleHistory([preview]);
                                    return;
                                  }
                                  commit({ type: "preview" });
                                });
                              }}
                            >
                              <div className="history-tile-media">
                                <PreviewFace item={preview} />
                              </div>
                            </button>
                          ) : (
                            <div className="history-expand-preview" data-preview-id={preview.id}>
                              <div className="history-tile-media">
                                <PreviewFace item={preview} />
                              </div>
                            </div>
                          )}
                          {preview.status === "succeeded" && preview.resultUrl ? (
                            <div className="media-actions">
                              <DownloadButton
                                label="Download"
                                onDownload={() =>
                                  void downloadMedia(
                                    preview.resultUrl ?? "",
                                    downloadFilename(preview),
                                  )
                                }
                              />
                              {readyInGroup.length > 1 ? (
                                <DownloadButton
                                  className="media-download-all"
                                  caption="All"
                                  label={`Download all ${readyInGroup.length} completed`}
                                  onDownload={() => void downloadAllMedia(readyInGroup)}
                                />
                              ) : null}
                            </div>
                          ) : null}
                          <label className="gallery-select history-select">
                            <input
                              type="checkbox"
                              checked={livePicked.includes(preview.id)}
                              aria-label={
                                openBatch.items.length > 1
                                  ? `Select variation ${openBatch.items.findIndex((entry) => entry.id === preview.id) + 1}`
                                  : "Select this one"
                              }
                              onChange={() => toggleIds([preview.id])}
                            />
                          </label>
                          {canFit ? <ExpandCorners /> : null}
                        </div>
                        {openBatch.items.length > 1 ? (
                          <div className="history-expand-versions" role="list" aria-label="Versions">
                            {versionsBesidePreview(openBatch.items, preview.id).map((item) => {
                              const index = openBatch.items.findIndex((entry) => entry.id === item.id);
                              return (
                                <div key={item.id} className="history-version-wrap" role="listitem">
                                <button
                                  type="button"
                                  draggable={historyItemsForGallery([item]).length > 0}
                                  onPointerDown={notePointer}
                                  onDragStart={(event) => rememberHistoryDrag(event, [item])}
                                  onDragEnd={finishHistoryDrag}
                                  className={`history-version${
                                    createGalleryOpen && historyKeySelected(galleryKeySet, [item]) ? " is-gallery" : ""
                                  }`}
                                  aria-label={
                                    createGalleryOpen
                                      ? historyKeySelected(galleryKeySet, [item])
                                        ? `Remove variation ${index + 1} from gallery`
                                        : `Add variation ${index + 1} to gallery`
                                      : `Show variation ${index + 1}`
                                  }
                                  aria-pressed={
                                    createGalleryOpen ? historyKeySelected(galleryKeySet, [item]) : undefined
                                  }
                                  onClick={(event) => {
                                    historyClick(event, () => {
                                      if (createGalleryOpen) {
                                        onToggleHistory([item]);
                                        return;
                                      }
                                      commit({ type: "version", versionId: item.id });
                                    });
                                  }}
                                >
                                  <div className="history-tile-media">
                                    <TileFace item={item} />
                                  </div>
                                </button>
                                <label className="gallery-select history-select">
                                  <input
                                    type="checkbox"
                                    checked={livePicked.includes(item.id)}
                                    aria-label={`Select variation ${index + 1}`}
                                    onChange={() => toggleIds([item.id])}
                                  />
                                </label>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                        {preview.prompt || preview.model ? (
                          <ExpandPrompt prompt={preview.prompt ?? ""} model={preview.model} mode={preview.mode} />
                        ) : null}
                        {expandVisible.fitOpen && canFit && preview.resultUrl ? (
                          <FullSizeMedia
                            src={preview.resultUrl}
                            alt={preview.prompt || "Library item"}
                            slides={fitSlides(openBatch.items)}
                            activeId={preview.id}
                            onSlide={(id) => commit({ type: "version", versionId: id })}
                            onClose={() => commit({ type: "close-fit" })}
                          />
                        ) : null}
                      </div>
                      <HistoryGroupBar
                        items={openBatch.items}
                        shown={preview}
                        picked={livePicked}
                        onPickGroup={pickGroup}
                        attachedIds={attachedIds}
                        attachSupported={attachSupported}
                        onAttach={onAttach}
                        summaries={gallerySummaries}
                        onAdd={onHistoryAddToGallery}
                        onCreate={onHistoryCreateGallery}
                        onDelete={onDelete ? deleteIds : undefined}
                      />
                    </div>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </div>
      </div>
      {pageCount > 1 ? (
        <nav className="history-pager" aria-label="Library pages">
          <button
            type="button"
            className="ghost-btn"
            disabled={page <= 1}
            onClick={() => onPage(page - 1)}
          >
            Previous
          </button>
          <label className="history-page-jump">
            <input
              className="history-page-input"
              type="text"
              inputMode="numeric"
              aria-label={`Page ${page} of ${pageCount}`}
              value={pageDraft}
              onChange={(event) => setPageDraft(event.target.value.replace(/[^\d]/g, ""))}
              onBlur={() => {
                if (pageCommitSkip.current) {
                  pageCommitSkip.current = false;
                  setPageDraft(String(page));
                  return;
                }
                const next = Number(pageDraft);
                if (!pageDraft || !Number.isFinite(next)) {
                  setPageDraft(String(page));
                  return;
                }
                const clamped = Math.min(pageCount, Math.max(1, Math.round(next)));
                setPageDraft(String(clamped));
                if (clamped !== page) onPage(clamped);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  pageCommitSkip.current = true;
                  setPageDraft(String(page));
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
      ) : null}
      </>
      ) : null}
    </aside>
  );
}
