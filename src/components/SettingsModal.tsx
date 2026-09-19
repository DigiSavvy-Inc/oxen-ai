import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  ALL_MODES,
  MODE_LABELS,
  api,
  type GenerationMode,
  type OxenModel,
  type StudioSettings,
} from "../lib/api";

type AllowRow = {
  github_login: string;
  added_by: string | null;
  created_at: number;
};

type SettingsPane = "api-key" | "models" | "cleanup" | "allowlist";

export function SettingsModal({
  onClose,
  favorites,
  settings,
  onSettingsChange,
  onFavoritesChange,
}: {
  onClose: () => void;
  favorites: OxenModel[];
  settings: StudioSettings | null;
  onSettingsChange: (settings: StudioSettings) => void;
  onFavoritesChange: () => Promise<void> | void;
}) {
  const { user, setHasOxenKey } = useAuth();
  const [pane, setPane] = useState<SettingsPane>("api-key");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [org, setOrg] = useState("");
  const [admins, setAdmins] = useState<string[]>([]);
  const [rows, setRows] = useState<AllowRow[]>([]);
  const [login, setLogin] = useState("");
  const [allowBusy, setAllowBusy] = useState(false);
  const [allowError, setAllowError] = useState<string | null>(null);
  const [modelSearch, setModelSearch] = useState("");
  const [modelHits, setModelHits] = useState<OxenModel[]>([]);
  const [modelBusy, setModelBusy] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);

  async function loadAllowlist() {
    const data = await api.allowlist();
    setOrg(data.org);
    setAdmins(data.admins);
    setRows(data.allowlist);
  }

  useEffect(() => {
    if (!user?.isAdmin) return;
    void loadAllowlist().catch((err) =>
      setAllowError(err instanceof Error ? err.message : "Failed to load allowlist"),
    );
  }, [user?.isAdmin]);

  useEffect(() => {
    if (!user?.hasOxenKey || !modelSearch.trim()) {
      setModelHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      void api
        .searchModels("", modelSearch.trim())
        .then((data) => setModelHits(data.models))
        .catch((err) =>
          setModelError(err instanceof Error ? err.message : "Search failed"),
        );
    }, 300);
    return () => window.clearTimeout(handle);
  }, [modelSearch, user?.hasOxenKey]);

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.saveOxenKey(apiKey);
      setHasOxenKey(true);
      setApiKey("");
      setMessage("Oxen API key saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save key");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      await api.clearOxenKey();
      setHasOxenKey(false);
      setMessage("Oxen API key removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear key");
    } finally {
      setBusy(false);
    }
  }

  async function addAllowlistUser() {
    setAllowBusy(true);
    setAllowError(null);
    try {
      await api.addAllowlist(login);
      setLogin("");
      await loadAllowlist();
    } catch (err) {
      setAllowError(err instanceof Error ? err.message : "Failed to add user");
    } finally {
      setAllowBusy(false);
    }
  }

  async function removeAllowlistUser(name: string) {
    setAllowBusy(true);
    setAllowError(null);
    try {
      await api.removeAllowlist(name);
      await loadAllowlist();
    } catch (err) {
      setAllowError(err instanceof Error ? err.message : "Failed to remove user");
    } finally {
      setAllowBusy(false);
    }
  }

  async function setModeDefault(mode: GenerationMode, modelId: string) {
    setModelBusy(true);
    setModelError(null);
    try {
      const nextMap = { ...(settings?.defaultModelByMode ?? {}) };
      if (modelId) nextMap[mode] = modelId;
      else delete nextMap[mode];
      const next = await api.saveStudioSettings({
        defaultModelByMode: nextMap,
      });
      onSettingsChange(next);
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Failed to save default");
    } finally {
      setModelBusy(false);
    }
  }

  async function toggleFavorite(id: string, favorited: boolean) {
    setModelBusy(true);
    setModelError(null);
    try {
      if (favorited) await api.unfavorite(id);
      else await api.favorite(id);
      await onFavoritesChange();
    } catch (err) {
      setModelError(err instanceof Error ? err.message : "Failed to update favorite");
    } finally {
      setModelBusy(false);
    }
  }

  async function runCleanup(action: "failed" | "thumbs") {
    setCleanupBusy(true);
    setCleanupError(null);
    setCleanupMessage(null);
    try {
      const result = await api.cleanupLibrary(action);
      if (action === "failed") {
        setCleanupMessage(
          result.deleted === 0
            ? "No failed or cancelled jobs to remove."
            : `Removed ${result.deleted} job${result.deleted === 1 ? "" : "s"} from the library.`,
        );
      } else {
        const more = result.remaining ? " Run again to continue." : "";
        setCleanupMessage(
          result.built === 0
            ? "No missing thumbnails to build."
            : `Built ${result.built} thumbnail${result.built === 1 ? "" : "s"}.${more}`,
        );
      }
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : "Cleanup failed");
    } finally {
      setCleanupBusy(false);
    }
  }

  function renderPane(selected: SettingsPane) {
    switch (selected) {
      case "api-key":
        return (
          <>
            <h3>Oxen API key</h3>
            <p>
              Encrypted at rest and only sent server-side to{" "}
              <code>hub.oxen.ai</code>. Get a key from your Oxen account settings.
            </p>
            <label htmlFor="oxen-key">API key</label>
            <input
              id="oxen-key"
              className="field"
              type="password"
              placeholder={user?.hasOxenKey ? "•••••••• (saved — paste to replace)" : "oxen_…"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
            {message ? <p className="settings-ok">{message}</p> : null}
            {error ? <p className="settings-bad">{error}</p> : null}
            <div className="modal-actions">
              {user?.hasOxenKey ? (
                <button className="ghost-btn" disabled={busy} onClick={() => void clear()}>
                  Remove key
                </button>
              ) : null}
              <button
                className="primary-btn"
                style={{ marginLeft: "auto" }}
                disabled={busy || !apiKey.trim()}
                onClick={() => void save()}
              >
                Save key
              </button>
            </div>
          </>
        );
      case "models":
        return (
          <>
            <h3>Models</h3>
            <p>
              Stars are stored on your Oxen account. Optional defaults are per
              Studio user and start empty.
            </p>
            {!user?.hasOxenKey ? (
              <p className="settings-bad">Add an Oxen API key first.</p>
            ) : (
              <>
                {ALL_MODES.map((mode) => (
                  <label key={mode} htmlFor={`default-${mode}`}>
                    Default · {MODE_LABELS[mode]}
                    <select
                      id={`default-${mode}`}
                      className="field"
                      disabled={modelBusy}
                      value={settings?.defaultModelByMode[mode] || ""}
                      onChange={(e) => void setModeDefault(mode, e.target.value)}
                    >
                      <option value="">None</option>
                      {favorites.map((item) => (
                        <option key={`${mode}-${item.id}`} value={item.id}>
                          {item.display_name || item.id}
                        </option>
                      ))}
                      {settings?.defaultModelByMode[mode] &&
                      !favorites.some((item) => item.id === settings.defaultModelByMode[mode]) ? (
                        <option value={settings.defaultModelByMode[mode]}>
                          {settings.defaultModelByMode[mode]}
                        </option>
                      ) : null}
                    </select>
                  </label>
                ))}
                <h3>Preferred</h3>
                <div className="allow-list">
                  {favorites.length === 0 ? (
                    <div className="history-empty" style={{ margin: 0 }}>
                      No Oxen favorites yet. Search below and star a model.
                    </div>
                  ) : (
                    favorites.map((item) => (
                      <div className="allow-row" key={item.id}>
                        <span>{item.display_name || item.id}</span>
                        <button
                          className="ghost-btn"
                          disabled={modelBusy}
                          onClick={() => void toggleFavorite(item.id, true)}
                        >
                          Unstar
                        </button>
                      </div>
                    ))
                  )}
                </div>
                <label htmlFor="model-search">Find a model to star</label>
                <input
                  id="model-search"
                  className="field"
                  placeholder="seedream, gpt-image, kling…"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                />
                <div className="allow-list">
                  {modelHits.map((item) => {
                    const starred = favorites.some((fav) => fav.id === item.id);
                    return (
                      <div className="allow-row" key={`hit-${item.id}`}>
                        <span>{item.display_name || item.id}</span>
                        <button
                          className="ghost-btn"
                          disabled={modelBusy}
                          onClick={() => void toggleFavorite(item.id, starred)}
                        >
                          {starred ? "Unstar" : "Star"}
                        </button>
                      </div>
                    );
                  })}
                </div>
                {modelError ? <p className="settings-bad">{modelError}</p> : null}
              </>
            )}
          </>
        );
      case "cleanup":
        return (
          <>
            <h3>Library cleanup</h3>
            <p>
              Removes jobs from DS Studio and their files in R2. Oxen billing is unchanged.
              Thumbnails are 320px JPEGs for the library grid; full results stay for the canvas
              and downloads.
            </p>
            <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
              <button
                type="button"
                className="ghost-btn"
                disabled={cleanupBusy}
                onClick={() => void runCleanup("failed")}
              >
                Delete failed jobs
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={cleanupBusy}
                onClick={() => void runCleanup("thumbs")}
              >
                Build missing thumbnails
              </button>
            </div>
            {cleanupMessage ? <p className="settings-ok">{cleanupMessage}</p> : null}
            {cleanupError ? <p className="settings-bad">{cleanupError}</p> : null}
          </>
        );
      case "allowlist":
        return (
          <>
            <h3>Access allowlist</h3>
            <p>
              Org members of <strong>{org || "…"}</strong> can sign in automatically.
              Admins ({admins.join(", ") || "none configured"}) can also add individual
              GitHub users here.
            </p>
            <div className="allow-list">
              {rows.length === 0 ? (
                <div className="history-empty" style={{ margin: 0 }}>
                  No ad-hoc users yet.
                </div>
              ) : (
                rows.map((row) => (
                  <div className="allow-row" key={row.github_login}>
                    <span>
                      @{row.github_login}
                      {row.added_by ? (
                        <span style={{ color: "var(--text-dim)" }}> · by {row.added_by}</span>
                      ) : null}
                    </span>
                    <button
                      className="ghost-btn"
                      disabled={allowBusy}
                      onClick={() => void removeAllowlistUser(row.github_login)}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
            <label htmlFor="gh-login">GitHub username</label>
            <div className="allow-add">
              <input
                id="gh-login"
                className="field"
                placeholder="octocat"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && login.trim() && !allowBusy) {
                    e.preventDefault();
                    void addAllowlistUser();
                  }
                }}
              />
              <button
                className="primary-btn"
                style={{ marginLeft: 0 }}
                disabled={allowBusy || !login.trim()}
                onClick={() => void addAllowlistUser()}
              >
                Add user
              </button>
            </div>
            {allowError ? <p className="settings-bad">{allowError}</p> : null}
          </>
        );
      default: {
        const _exhaustive: never = selected;
        return _exhaustive;
      }
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2>Settings</h2>
          <button className="ghost-btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="Settings">
            <button
              type="button"
              className={`settings-nav-btn${pane === "api-key" ? " active" : ""}`}
              onClick={() => setPane("api-key")}
            >
              API key
            </button>
            <button
              type="button"
              className={`settings-nav-btn${pane === "models" ? " active" : ""}`}
              onClick={() => setPane("models")}
            >
              Models
            </button>
            <button
              type="button"
              className={`settings-nav-btn${pane === "cleanup" ? " active" : ""}`}
              onClick={() => setPane("cleanup")}
            >
              Cleanup
            </button>
            {user?.isAdmin ? (
              <button
                type="button"
                className={`settings-nav-btn${pane === "allowlist" ? " active" : ""}`}
                onClick={() => setPane("allowlist")}
              >
                Allowlist
              </button>
            ) : null}
          </nav>
          <div className="settings-pane">{renderPane(pane)}</div>
        </div>
      </div>
    </div>
  );
}
