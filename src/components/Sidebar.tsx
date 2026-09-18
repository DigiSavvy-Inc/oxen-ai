import { MODE_LABELS, type Generation, type GenerationMode } from "../lib/api";

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
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand">
          <div className="brand-mark">Ox</div>
          <div className="brand-copy">
            <strong>Oxen Studio</strong>
            <span>Media composer</span>
          </div>
        </div>
      </div>

      <div className="history">
        {generations.length === 0 ? (
          <div className="history-empty">
            No generations yet. Write a prompt below and hit Generate — jobs run
            through Oxen&apos;s async queue.
          </div>
        ) : (
          generations.map((g) => (
            <button
              key={g.id}
              type="button"
              className={`history-item${selectedId === g.id ? " active" : ""}`}
              onClick={() => onSelect(g.id)}
            >
              <div className="thumb">
                {g.resultUrl && g.mediaType === "image" ? (
                  <img src={g.resultUrl} alt="" />
                ) : g.resultUrl && g.mediaType === "video" ? (
                  <video src={g.resultUrl} muted />
                ) : (
                  <span>{g.mediaType === "video" ? "VID" : "IMG"}</span>
                )}
              </div>
              <div className="history-meta">
                <div className="prompt">{g.prompt || "(no prompt)"}</div>
                <div className="sub">
                  <span className={`pill ${statusClass(g.status)}`}>{g.status}</span>
                  <span className="pill">
                    {MODE_LABELS[g.mode as GenerationMode] || g.mode}
                  </span>
                </div>
              </div>
            </button>
          ))
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
