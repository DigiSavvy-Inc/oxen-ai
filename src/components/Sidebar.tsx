import { useMemo, useState } from "react";
import { coverGeneration, groupGenerationBatches } from "../lib/batches";
import type { Generation } from "../lib/api";
import { completedMedia, tilePreviewUrl } from "../lib/download";
import { collectUniqueTags, suggestTags, tagsMatchQuery } from "../lib/tags";

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
  return <span>{item.mediaType === "video" ? "VID" : "IMG"}</span>;
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
}: {
  generations: Generation[];
  selectedId: string | null;
  loading?: boolean;
  downloadingAll?: boolean;
  onSelect: (id: string) => void;
  onClose?: () => void;
  onDownloadAll?: () => void;
  onDelete?: (ids: string[], fromOxen?: boolean) => void;
}) {
  const [tagQuery, setTagQuery] = useState("");
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
              {downloadingAll ? "Downloading…" : "Download all"}
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
            <div className="history-empty">Loading library…</div>
          ) : batches.length === 0 ? (
            <div className="history-empty">
              {tagQuery.trim()
                ? "No media with that tag."
                : "No generations yet. Write a prompt and hit Generate — jobs run through Oxen's async queue."}
            </div>
          ) : (
            batches.map((batch) => {
              const cover = coverGeneration(batch.items);
              const selected = batch.items.some((item) => item.id === selectedId);
              return (
                <div
                  key={batch.id}
                  className={`history-tile${selected ? " active" : ""}`}
                >
                  <div className="history-tile-square">
                    <button
                      type="button"
                      className="history-tile-hit"
                      onClick={() => onSelect(cover?.id ?? batch.items[0]?.id ?? batch.id)}
                      title={cover?.prompt || "Generation"}
                    >
                      <div className="history-tile-media">
                        {cover ? <TileFace item={cover} allowFull /> : null}
                      </div>
                    </button>
                    {batch.items.length > 1 ? (
                      <span className="history-count" aria-label={`${batch.items.length} variations`}>
                        {batch.items.length}
                      </span>
                    ) : null}
                    {onDelete ? (
                      <div className="media-delete-group">
                        <button
                          type="button"
                          className="media-delete"
                          aria-label="Remove from Studio"
                          title="Remove from Studio"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onDelete(batch.items.map((item) => item.id));
                          }}
                        >
                          ×
                        </button>
                        <button
                          type="button"
                          className="media-delete media-delete-oxen"
                          aria-label="Remove from Studio and Oxen"
                          title="Remove from Studio and Oxen"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onDelete(
                              batch.items.map((item) => item.id),
                              true,
                            );
                          }}
                        >
                          Oxen
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
