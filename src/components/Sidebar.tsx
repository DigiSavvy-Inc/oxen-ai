import { coverGeneration, groupGenerationBatches } from "../lib/batches";
import type { Generation } from "../lib/api";

function statusClass(status: string) {
  if (status === "succeeded") return "ok";
  if (status === "failed" || status === "cancelled") return "bad";
  return "warn";
}

export function Sidebar({
  generations,
  selectedId,
  onSelect,
  onOpenSettings,
  onLogout,
  userLogin,
  avatarUrl,
  isAdmin,
  hasOxenKey,
}: {
  generations: Generation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  userLogin: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  hasOxenKey: boolean;
}) {
  const batches = groupGenerationBatches(generations);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <img className="brand-mark-img" src="/favicon.svg" alt="" />
          <div className="brand-copy">
            <strong>DS Studio</strong>
            <span>Media library</span>
          </div>
        </div>
      </div>

      <div className="history history-grid">
        {batches.length === 0 ? (
          <div className="history-empty">
            No generations yet. Write a prompt below and hit Generate — jobs run through Oxen&apos;s
            async queue.
          </div>
        ) : (
          batches.map((batch) => {
            const cover = coverGeneration(batch.items);
            const selected = batch.items.some((item) => item.id === selectedId);
            const status = cover?.status ?? "queued";
            return (
              <button
                key={batch.id}
                type="button"
                className={`history-tile${selected ? " active" : ""}`}
                onClick={() => onSelect(cover?.id ?? batch.items[0]?.id ?? batch.id)}
                title={cover?.prompt || "Generation"}
              >
                <div className="history-tile-media">
                  {cover?.resultUrl && cover.mediaType === "image" ? (
                    <img src={cover.resultUrl} alt="" />
                  ) : cover?.resultUrl && cover.mediaType === "video" ? (
                    <video src={cover.resultUrl} muted />
                  ) : (
                    <span>{cover?.mediaType === "video" ? "VID" : "IMG"}</span>
                  )}
                </div>
                {batch.items.length > 1 ? (
                  <span className="history-count">{batch.items.length}</span>
                ) : null}
                <span className={`history-status pill ${statusClass(status)}`}>{status}</span>
              </button>
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
