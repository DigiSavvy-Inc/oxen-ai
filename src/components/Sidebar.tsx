import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { coverGeneration, groupGenerationBatches, isActiveGeneration } from "../lib/batches";
import type { Generation } from "../lib/api";
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
import { collectUniqueTags, suggestTags, tagsMatchQuery } from "../lib/tags";
import { CopyPrompt } from "./CopyPrompt";
import { DownloadButton } from "./DownloadButton";
import { ExpandCorners, FullSizeMedia, type FitSlide } from "./FullSizeMedia";
import { Loader } from "./Loader";
import { MediaDeleteGroup } from "./MediaDeleteGroup";
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
    return <img src={src} alt="" loading="lazy" />;
  }
  if (src && item.mediaType === "video") {
    return (
      <>
        <video src={item.resultUrl || src} muted playsInline preload="metadata" />
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
  return <span>{item.mediaType === "video" ? "VID" : "IMG"}</span>;
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

function attachKindLabel(item: Generation): string {
  if (item.mediaType === "video") return "video";
  if (item.mediaType === "audio") return "audio";
  return "images";
}

function ExpandPrompt({ prompt, model }: { prompt: string; model: string }) {
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
            {modelName}
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

function emptyLibraryMessage(tagQuery: string, loadError?: string | null): string {
  if (loadError) return loadError;
  if (tagQuery.trim()) return "No media with that tag.";
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
  onSelect,
  onClose,
  onDownloadAll,
  onDelete,
  attachedIds,
  onAttach,
  attachSupported,
}: {
  logoUrl: string;
  generations: Generation[];
  selectedId: string | null;
  loading?: boolean;
  loadError?: string | null;
  downloadingAll?: boolean;
  onSelect: (id: string | null) => void;
  onClose?: () => void;
  onDownloadAll?: () => void;
  onDelete?: (ids: string[], fromOxen?: boolean) => void;
  attachedIds?: Set<string>;
  onAttach?: (item: Generation) => void;
  attachSupported?: (item: Generation) => boolean;
}) {
  const [tagQuery, setTagQuery] = useState("");
  const [expand, setExpand] = useState<GalleryExpandState>(CLOSED_EXPAND);
  const expandRef = useRef(expand);
  const expandedTileRef = useRef<HTMLDivElement>(null);
  const allTags = useMemo(
    () => collectUniqueTags(generations.map((item) => item.tags)),
    [generations],
  );
  const previews = useMemo(() => suggestTags(allTags, tagQuery), [allTags, tagQuery]);
  const batches = useMemo(() => {
    const grouped = groupGenerationBatches(generations);
    if (!tagQuery.trim()) return grouped;
    return grouped.filter((batch) =>
      batch.items.some((item) => tagsMatchQuery(item.tags, tagQuery)),
    );
  }, [generations, tagQuery]);
  const readyAll = useMemo(() => completedMedia(generations), [generations]);
  const expandVisible =
    !expand.expandedId || batches.some((batch) => batch.id === expand.expandedId)
      ? expand
      : CLOSED_EXPAND;

  useEffect(() => {
    if (!expandVisible.expandedId) return;
    expandedTileRef.current?.scrollIntoView({ block: "nearest" });
  }, [expandVisible.expandedId]);

  function commit(action: GalleryExpandAction) {
    const next = galleryExpandTransition(expandRef.current, action);
    expandRef.current = next;
    setExpand(next);
    if (next.peek !== undefined) onSelect(next.peek);
  }

  return (
    <aside className="sidebar" id="media-library">
      <div className="sidebar-header">
        <div className="brand">
          <img className="brand-mark-img" src={logoUrl} alt="" />
          <div className="brand-copy">
            <strong>Library</strong>
            <span>Past work</span>
          </div>
        </div>
        <div className="sidebar-header-actions">
          {onDownloadAll && readyAll.length > 0 ? (
            <button
              type="button"
              className="ghost-btn"
              disabled={downloadingAll}
              onClick={onDownloadAll}
            >
              {downloadingAll ? <Loader size="sm" label="Downloading…" /> : "Download all"}
            </button>
          ) : null}
          {onClose ? (
            <button type="button" className="icon-btn sidebar-close" aria-label="Close library" onClick={onClose}>
              ×
            </button>
          ) : null}
        </div>
      </div>

      <div className="tag-filter">
        <input
          className="tag-filter-input"
          value={tagQuery}
          placeholder="Filter by tag"
          aria-label="Filter by tag"
          onChange={(event) => setTagQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setTagQuery("");
            if (event.key === "Enter" && previews[0]) {
              event.preventDefault();
              setTagQuery(previews[0]);
            }
          }}
        />
        {previews.length > 0 ? (
          <div className="tag-preview" role="listbox" aria-label="Matching tags">
            {previews.map((tag) => (
              <button
                key={tag.toLowerCase()}
                type="button"
                className={`tag-chip preview${tagQuery.trim().toLowerCase() === tag.toLowerCase() ? " active" : ""}`}
                onClick={() => setTagQuery(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : tagQuery.trim() && allTags.length > 0 ? (
          <div className="tag-preview-empty">No tags match “{tagQuery.trim()}”</div>
        ) : null}
      </div>

      <div className="history">
        <div className="history-grid">
          {loading && batches.length === 0 ? (
            <div className="history-empty">
              <Loader size="md" label="Loading library…" />
            </div>
          ) : batches.length === 0 ? (
            <div className="history-empty">
              {emptyLibraryMessage(tagQuery, loadError)}
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
                  {row.map((batch) => {
                    const cover = coverGeneration(batch.items);
                    const openId = batch.items[0]?.id ?? batch.id;
                    const mediaType = batch.items.some((item) => item.mediaType === "video")
                      ? "video"
                      : (cover?.mediaType ?? null);
                    const multi = batch.items.length > 1;
                    const expanded = expandVisible.expandedId === batch.id;
                    const singleLabel = mediaType === "video" ? "video" : mediaType === "audio" ? "audio" : "image";
                    const selected = batch.items.some((item) => item.id === selectedId);
                    const face = expanded && preview ? preview : cover;
                    return (
                      <div
                        key={batch.id}
                        className={`history-tile${selected ? " active" : ""}${expanded ? " is-open" : ""}`}
                        data-batch-id={batch.id}
                      >
                        <div className="history-tile-square">
                          <button
                            type="button"
                            className="history-tile-hit"
                            aria-expanded={expanded}
                            aria-label={
                              expanded
                                ? multi
                                  ? `Collapse ${batch.items.length} variations`
                                  : `Collapse ${singleLabel}`
                                : multi
                                  ? `${batch.items.length} variations`
                                  : `Open ${singleLabel}`
                            }
                            title={cover?.prompt || "Generation"}
                            onClick={() =>
                              commit({
                                type: "tile",
                                batchId: batch.id,
                                count: batch.items.length,
                                openId,
                                mediaType,
                              })
                            }
                          >
                            <div className="history-tile-media">
                              {face ? <TileFace item={face} allowFull /> : null}
                            </div>
                          </button>
                          {multi ? (
                            <span className="history-count">{batch.items.length}</span>
                          ) : null}
                          {onDelete ? (
                            <MediaDeleteGroup
                              onStudio={() => onDelete(batch.items.map((item) => item.id))}
                              onOxen={() => onDelete(batch.items.map((item) => item.id), true)}
                            />
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                  {openBatch && preview ? (
                    <div className="history-tile is-expanded" ref={expandedTileRef} key={`${openBatch.id}-open`}>
                      <div className="history-expand">
                        <div className="history-expand-frame">
                          {canFit ? (
                            <button
                              type="button"
                              className="history-expand-preview"
                              aria-label="View full size"
                              data-preview-id={preview.id}
                              onClick={() => commit({ type: "preview" })}
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
                          {onAttach ? (
                            <button
                              type="button"
                              className={`history-expand-attach${attachedIds?.has(preview.id) ? " is-attached" : ""}`}
                              disabled={!attachSupported?.(preview)}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                if (!attachSupported?.(preview)) return;
                                onAttach(preview);
                              }}
                            >
                              {attachedIds?.has(preview.id)
                                ? "Attached"
                                : attachSupported?.(preview)
                                  ? "Click to attach"
                                  : `Can't attach ${attachKindLabel(preview)}`}
                            </button>
                          ) : null}
                          {canFit ? <ExpandCorners /> : null}
                        </div>
                        {openBatch.items.length > 1 ? (
                          <div className="history-expand-versions" role="list" aria-label="Versions">
                            {versionsBesidePreview(openBatch.items, preview.id).map((item) => {
                              const index = openBatch.items.findIndex((entry) => entry.id === item.id);
                              return (
                                <button
                                  key={item.id}
                                  type="button"
                                  className="history-version"
                                  aria-label={`Show variation ${index + 1}`}
                                  onClick={() => commit({ type: "version", versionId: item.id })}
                                >
                                  <div className="history-tile-media">
                                    <TileFace item={item} allowFull />
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                        {preview.prompt || preview.model ? (
                          <ExpandPrompt prompt={preview.prompt ?? ""} model={preview.model} />
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
                    </div>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
