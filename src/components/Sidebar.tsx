import { useMemo, useState } from "react";
import { coverGeneration, groupGenerationBatches } from "../lib/batches";
import type { Generation } from "../lib/api";
import { completedMedia, downloadAllMedia, downloadFilename, downloadMedia } from "../lib/download";
import { collectUniqueTags, suggestTags, tagsMatchQuery } from "../lib/tags";
import { DownloadButton } from "./DownloadButton";

function statusClass(status: string) {
  if (status === "succeeded") return "ok";
  if (status === "failed" || status === "cancelled") return "bad";
  return "warn";
}

function TileFace({ item }: { item: Generation }) {
  if (item.resultUrl && item.mediaType === "image") {
    return <img src={item.resultUrl} alt="" />;
  }
  if (item.resultUrl && item.mediaType === "video") {
    return <video src={item.resultUrl} muted playsInline preload="metadata" />;
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
  onOpenSettings,
  onLogout,
  userLogin,
  avatarUrl,
  isAdmin,
  hasOxenKey,
}: {
  generations: Generation[];
  selectedId: string | null;
  loading?: boolean;
  downloadingAll?: boolean;
  onSelect: (id: string) => void;
  onClose?: () => void;
  onDownloadAll?: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  userLogin: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  hasOxenKey: boolean;
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
            <strong>DS Studio</strong>
            <span>Media library</span>
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

      <div className="history history-grid">
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
            const status = cover?.status ?? "queued";
            const ready = completedMedia(batch.items);
            return (
              <div
                key={batch.id}
                className={`history-tile${selected ? " active" : ""}`}
              >
                <button
                  type="button"
                  className="history-tile-hit"
                  onClick={() => onSelect(cover?.id ?? batch.items[0]?.id ?? batch.id)}
                  title={cover?.prompt || "Generation"}
                >
                  <div
                    className={`history-tile-media${
                      batch.items.length > 1 ? ` mosaic mosaic-${Math.min(batch.items.length, 4)}` : ""
                    }`}
                  >
                    {(batch.items.length > 1 ? batch.items.slice(0, 4) : [cover ?? batch.items[0]]).map(
                      (item) => (item ? <TileFace key={item.id} item={item} /> : null),
                    )}
                  </div>
                </button>
                {batch.items.length > 1 ? (
                  <span className="history-count">{batch.items.length}</span>
                ) : null}
                <span className={`history-status pill ${statusClass(status)}`}>{status}</span>
                {ready.length === 1 && ready[0]?.resultUrl ? (
                  <DownloadButton
                    label="Download"
                    onDownload={() =>
                      void downloadMedia(ready[0]?.resultUrl ?? "", downloadFilename(ready[0]!))
                    }
                  />
                ) : ready.length > 1 ? (
                  <DownloadButton
                    caption={String(ready.length)}
                    label={`Download ${ready.length} completed`}
                    onDownload={() => void downloadAllMedia(ready)}
                  />
                ) : null}
              </div>
            );
          })
        )}
      </div>

      <div className="sidebar-footer">
        <div className="user-row">
          {avatarUrl ? <img src={avatarUrl} alt="" /> : <div className="brand-mark">?</div>}
          <div style={{ minWidth: 0 }}>
            <div className="name">@{userLogin}</div>
            <div className="role">
              {hasOxenKey ? "Oxen key ready" : "Add Oxen key in Settings"}
              {isAdmin ? " · admin" : ""}
            </div>
          </div>
        </div>
        <div className="footer-actions">
          <button className="ghost-btn" type="button" onClick={onOpenSettings}>
            Settings
          </button>
          <button className="ghost-btn" type="button" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>
    </aside>
  );
}
