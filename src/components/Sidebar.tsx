import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { coverGeneration, groupGenerationBatches, isActiveGeneration } from "../lib/batches";
import type { Generation } from "../lib/api";
import { completedMedia, tilePreviewUrl } from "../lib/download";
import {
  galleryExpandTransition,
  versionsBesidePreview,
  type GalleryExpandAction,
  type GalleryExpandState,
} from "../lib/gallery-expand";
import { collectUniqueTags, suggestTags, tagsMatchQuery } from "../lib/tags";
import { CopyPrompt } from "./CopyPrompt";
import { ExpandCorners, FullSizeMedia, type FitSlide } from "./FullSizeMedia";
import { Loader } from "./Loader";
import { MediaDeleteGroup } from "./MediaDeleteGroup";

function tileSrc(item: Generation, allowFull = false): string | null {
  return tilePreviewUrl(item) || (allowFull ? item.resultUrl : null);
}

function TileFace({ item, allowFull = false }: { item: Generation; allowFull?: boolean }) {
  const src = tileSrc(item, allowFull);
  if (src && item.mediaType === "image") {
    return <img src={src} alt="" loading="lazy" />;
  }
  if (src && item.mediaType === "video") {
    return <video src={item.resultUrl || src} muted playsInline preload="metadata" />;
  }
  if (isActiveGeneration(item) && !src) {
    return <Loader size="sm" />;
  }
  return <span>{item.mediaType === "video" ? "VID" : "IMG"}</span>;
}

function PreviewFace({ item }: { item: Generation }) {
  if (item.mediaType === "image" && item.resultUrl) {
    return <img src={item.resultUrl} alt="" />;
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
      },
    ];
  });
}

function attachKindLabel(item: Generation): string {
  if (item.mediaType === "video") return "video";
  if (item.mediaType === "audio") return "audio";
  return "images";
}

function ExpandPrompt({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="history-prompt">
      <button
        type="button"
        className="history-prompt-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide prompt" : "Prompt"}
      </button>
      <div className={`history-prompt-panel${open ? " is-open" : ""}`}>
        <div className="history-prompt-panel-inner">
          <CopyPrompt prompt={prompt} className="history-prompt-quote" />
        </div>
      </div>
    </div>
  );
}

const CLOSED_EXPAND: GalleryExpandState = {
  expandedId: null,
  previewId: null,
  fitOpen: false,
};

const GALLERY_COLUMNS = 3;

function chunkBatches<T>(items: T[], size = GALLERY_COLUMNS): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size));
  }
  return rows;
}

export function Sidebar({
  generations,
  selectedId,
  loading,
  downloadingAll,
  onSelect,
  onClose,
  onDownloadAll,
  onDelete,
  attachedIds,
  onAttach,
  attachSupported,
}: {
  generations: Generation[];
  selectedId: string | null;
  loading?: boolean;
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
          <img className="brand-mark-img" src="/favicon.svg" alt="" />
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
              {tagQuery.trim()
                ? "No media with that tag."
                : "No generations yet. Write a prompt and hit Generate — jobs run through Oxen's async queue."}
            </div>
          ) : (
            chunkBatches(batches).map((row) => {
              const openBatch = row.find((batch) => batch.id === expandVisible.expandedId) ?? null;
              const preview = openBatch
                ? (openBatch.items.find((item) => item.id === expandVisible.previewId) ??
                  coverGeneration(openBatch.items) ??
                  openBatch.items[0])
                : null;
              const others =
                openBatch && preview ? versionsBesidePreview(openBatch.items, preview.id) : [];
              const canFit = canOpenFit(preview);
              return (
                <Fragment key={row.map((batch) => batch.id).join(":")}>
                  {row.map((batch) => {
                    const cover = coverGeneration(batch.items);
                    const openId = cover?.id ?? batch.items[0]?.id ?? batch.id;
                    const mediaType = batch.items.some((item) => item.mediaType === "video")
                      ? "video"
                      : (cover?.mediaType ?? null);
                    const multi = batch.items.length > 1;
                    const inGallery = multi || mediaType === "video";
                    const expanded = expandVisible.expandedId === batch.id;
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
                            aria-expanded={inGallery ? expanded : undefined}
                            aria-label={
                              inGallery
                                ? expanded
                                  ? multi
                                    ? `Collapse ${batch.items.length} variations`
                                    : "Collapse video"
                                  : multi
                                    ? `${batch.items.length} variations`
                                    : "Open video"
                                : undefined
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
                              <ExpandCorners />
                            </button>
                          ) : (
                            <div className="history-expand-preview" data-preview-id={preview.id}>
                              <div className="history-tile-media">
                                <PreviewFace item={preview} />
                              </div>
                            </div>
                          )}
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
                        </div>
                        {others.length > 0 ? (
                          <div className="history-expand-versions" role="list" aria-label="Other versions">
                            {others.map((item) => {
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
                        {preview.prompt ? <ExpandPrompt prompt={preview.prompt} /> : null}
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
