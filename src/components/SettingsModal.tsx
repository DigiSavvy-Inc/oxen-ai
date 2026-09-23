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
import {
  canPromptInstall,
  canUseNotifications,
  disablePushNotifications,
  enablePushNotifications,
  isStandaloneDisplay,
  notificationPermission,
  onInstallAvailable,
  promptInstall,
} from "../lib/pwa";
import { StatusWait } from "./StatusWait";

type AllowRow = {
  github_login: string;
  added_by: string | null;
  created_at: number;
};

type SettingsPane = "api-key" | "models" | "notifications" | "cleanup" | "allowlist";
type CleanupAction = "failed" | "thumbs" | "all";

function cleanupWaitLabel(action: CleanupAction): string {
  switch (action) {
    case "failed":
      return "Deleting failed jobs";
    case "thumbs":
      return "Building missing thumbnails";
    case "all":
      return "Deleting all media";
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function SettingsModal({
  onClose,
  favorites,
  settings,
  onSettingsChange,
  onFavoritesChange,
  onLibraryCleanup,
}: {
  onClose: () => void;
  favorites: OxenModel[];
  settings: StudioSettings | null;
  onSettingsChange: (settings: StudioSettings) => void;
  onFavoritesChange: () => Promise<void> | void;
  onLibraryCleanup?: (action: "failed" | "thumbs" | "all") => void;
}) {
  const { user, setHasOxenKey } = useAuth();
  const [pane, setPane] = useState<SettingsPane>("api-key");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [keyWait, setKeyWait] = useState<string | null>(null);
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
  const [cleanupRunning, setCleanupRunning] = useState<CleanupAction | null>(null);
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const [cleanupError, setCleanupError] = useState<string | null>(null);
  const cleanupBusy = cleanupRunning !== null;
  const [nukeConfirm, setNukeConfirm] = useState(false);
  const [nukeOxen, setNukeOxen] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [notifyPermission, setNotifyPermission] = useState<
    NotificationPermission | "unsupported"
  >(() => notificationPermission());
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyMessage, setNotifyMessage] = useState<string | null>(null);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const [installReady, setInstallReady] = useState(() => canPromptInstall());
  const [installed, setInstalled] = useState(() => isStandaloneDisplay());
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
    return onInstallAvailable(() => setInstallReady(canPromptInstall()));
  }, []);

  useEffect(() => {
    if (pane !== "notifications") return;
    void api
      .pushConfig()
      .then((data) => {
        setPushEnabled(data.enabled);
        setPushSubscribed(data.subscribed);
      })
      .catch((err) =>
        setNotifyError(err instanceof Error ? err.message : "Failed to load notification settings"),
      );
  }, [pane]);

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

  function selectPane(next: SettingsPane) {
    setPane(next);
    if (next !== "cleanup") setNukeConfirm(false);
  }

  async function save() {
    setBusy(true);
    setKeyWait("Saving key");
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
      setKeyWait(null);
    }
  }

  async function clear() {
    setBusy(true);
    setKeyWait("Removing key");
    setError(null);
    try {
      await api.clearOxenKey();
      setHasOxenKey(false);
      setMessage("Oxen API key removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear key");
    } finally {
      setBusy(false);
      setKeyWait(null);
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

  async function installApp() {
    setNotifyError(null);
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      setInstallReady(false);
      setInstalled(true);
      setNotifyMessage("DS Studio is installing. Open it from your home screen.");
      return;
    }
    if (outcome === "unavailable") {
      setNotifyError("Your browser did not offer an install prompt. Use the Add to Home Screen steps below.");
    }
  }

  async function enableNotifications() {
    setNotifyBusy(true);
    setNotifyError(null);
    setNotifyMessage(null);
    try {
      const result = await enablePushNotifications();
      setNotifyPermission(result.permission);
      setPushSubscribed(result.subscribed);
      if (result.permission === "denied") {
        setNotifyError("Notifications are blocked. Allow them for this site in your phone settings.");
      } else if (result.permission === "unsupported") {
        setNotifyError("This browser does not support notifications.");
      } else if (result.subscribed) {
        setNotifyMessage("You’ll get a notification when a generation finishes, even if DS Studio is closed.");
      } else {
        setNotifyMessage(
          "Notifications are on while DS Studio is open. Install the app and enable again for alerts after you leave.",
        );
      }
    } catch (err) {
      setNotifyError(err instanceof Error ? err.message : "Failed to enable notifications");
    } finally {
      setNotifyBusy(false);
    }
  }

  async function disableNotifications() {
    setNotifyBusy(true);
    setNotifyError(null);
    setNotifyMessage(null);
    try {
      await disablePushNotifications();
      setPushSubscribed(false);
      setNotifyMessage("Push notifications turned off on this device.");
    } catch (err) {
      setNotifyError(err instanceof Error ? err.message : "Failed to disable notifications");
    } finally {
      setNotifyBusy(false);
    }
  }

  async function runCleanup(action: CleanupAction, fromOxen = false) {
    setCleanupRunning(action);
    setCleanupError(null);
    setCleanupMessage(null);
    try {
      const result = await api.cleanupLibrary(action, { fromOxen });
      onLibraryCleanup?.(action);
      switch (action) {
        case "failed":
          setCleanupMessage(
            result.deleted === 0
              ? "No failed or cancelled jobs to remove."
              : `Removed ${result.deleted} job${result.deleted === 1 ? "" : "s"} from the library.`,
          );
          break;
        case "thumbs": {
          const more = result.remaining ? " Run again to continue." : "";
          setCleanupMessage(
            result.built === 0
              ? "No missing thumbnails to build."
              : `Built ${result.built} thumbnail${result.built === 1 ? "" : "s"}.${more}`,
          );
          break;
        }
        case "all": {
          const oxenNote =
            fromOxen && (result.oxenFailed ?? 0) > 0
              ? ` ${result.oxenFailed} Oxen file${result.oxenFailed === 1 ? "" : "s"} could not be removed.`
              : fromOxen
                ? " Oxen playground copies were removed when a matching file URL existed."
                : "";
          setCleanupMessage(
            result.deleted === 0
              ? `Studio media is empty.${oxenNote}`
              : `Removed ${result.deleted} job${result.deleted === 1 ? "" : "s"} from Studio.${oxenNote}`,
          );
          setNukeConfirm(false);
          break;
        }
        default: {
          const _exhaustive: never = action;
          return _exhaustive;
        }
      }
    } catch (err) {
      setCleanupError(err instanceof Error ? err.message : "Cleanup failed");
    } finally {
      setCleanupRunning(null);
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
            {keyWait ? <StatusWait label={keyWait} /> : null}
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
                {modelBusy ? <StatusWait label="Updating models" /> : null}
              </>
            )}
          </>
        );
      case "notifications":
        return (
          <>
            <h3>Install DS Studio</h3>
            <p>
              Add it to your phone’s home screen so it opens like an app. iPhone needs this
              step before notifications can work in the background.
            </p>
            {installed ? (
              <p className="settings-ok">This session is already running as an installed app.</p>
            ) : (
              <ol className="settings-steps">
                <li>
                  <strong>iPhone / iPad:</strong> Safari → Share → Add to Home Screen.
                </li>
                <li>
                  <strong>Android:</strong> Chrome menu → Install app or Add to Home Screen.
                </li>
                <li>
                  <strong>Desktop Chrome:</strong> the install icon in the address bar, or the
                  button below when it appears.
                </li>
              </ol>
            )}
            {!installed && installReady ? (
              <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
                <button
                  type="button"
                  className="primary-btn"
                  style={{ marginLeft: 0 }}
                  onClick={() => void installApp()}
                >
                  Install DS Studio
                </button>
              </div>
            ) : null}

            <h3>Notifications</h3>
            <p>
              Get an alert when an image or video finishes. On iPhone, open the installed app
              first, then tap Enable.
            </p>
            {!canUseNotifications() ? (
              <p className="settings-bad">This browser does not support notifications.</p>
            ) : (
              <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
                {pushSubscribed || notifyPermission === "granted" ? (
                  <button
                    type="button"
                    className="ghost-btn"
                    disabled={notifyBusy}
                    onClick={() => void disableNotifications()}
                  >
                    Turn off
                  </button>
                ) : null}
                <button
                  type="button"
                  className="primary-btn"
                  style={{ marginLeft: 0 }}
                  disabled={notifyBusy}
                  onClick={() => void enableNotifications()}
                >
                  Enable notifications
                </button>
              </div>
            )}
            {pushEnabled && pushSubscribed ? (
              <p className="settings-ok">Background alerts are on for this device.</p>
            ) : null}
            {!pushEnabled && notifyPermission === "granted" ? (
              <p>
                Local alerts work while the app is open. Background push is not configured on
                this server yet.
              </p>
            ) : null}
            {notifyMessage ? <p className="settings-ok">{notifyMessage}</p> : null}
            {notifyError ? <p className="settings-bad">{notifyError}</p> : null}
            {notifyBusy ? <StatusWait label="Updating notifications" /> : null}
          </>
        );
      case "cleanup":
        return (
          <>
            <h3>Library cleanup</h3>
            <p>
              Removes jobs from DS Studio and their files in R2. Hover × in the library
              removes Studio copies only. Oxen also deletes the matching playground file
              when we can find it. Queue billing is unchanged.
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
                {cleanupRunning === "failed" ? "Deleting…" : "Delete failed jobs"}
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={cleanupBusy}
                onClick={() => void runCleanup("thumbs")}
              >
                {cleanupRunning === "thumbs" ? "Building…" : "Build missing thumbnails"}
              </button>
            </div>
            {cleanupRunning ? <StatusWait label={cleanupWaitLabel(cleanupRunning)} /> : null}
            {cleanupMessage ? <p className="settings-ok">{cleanupMessage}</p> : null}
            {cleanupError ? <p className="settings-bad">{cleanupError}</p> : null}
            <div className="settings-danger">
              <h4>Delete all media</h4>
              <p>
                Permanently removes every generation for this account from D1 and R2, including
                uploads. Optionally also deletes the matching files in your Oxen playground.
                Queue billing is unchanged.
              </p>
              <label className="settings-check" htmlFor="nuke-oxen">
                <input
                  id="nuke-oxen"
                  type="checkbox"
                  checked={nukeOxen}
                  onChange={(e) => setNukeOxen(e.target.checked)}
                  disabled={cleanupBusy}
                />
                Also delete from Oxen
              </label>
              <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
                {nukeConfirm ? (
                  <>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={cleanupBusy}
                      onClick={() => setNukeConfirm(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="ghost-btn danger-btn"
                      disabled={cleanupBusy}
                      onClick={() => void runCleanup("all", nukeOxen)}
                    >
                      Yes, delete everything
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="ghost-btn danger-btn"
                    disabled={cleanupBusy}
                    onClick={() => setNukeConfirm(true)}
                  >
                    Delete all media
                  </button>
                )}
              </div>
            </div>
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
            {allowBusy ? <StatusWait label="Updating allowlist" /> : null}
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
              onClick={() => selectPane("api-key")}
            >
              API key
            </button>
            <button
              type="button"
              className={`settings-nav-btn${pane === "models" ? " active" : ""}`}
              onClick={() => selectPane("models")}
            >
              Models
            </button>
            <button
              type="button"
              className={`settings-nav-btn${pane === "notifications" ? " active" : ""}`}
              onClick={() => selectPane("notifications")}
            >
              Notifications
            </button>
            <button
              type="button"
              className={`settings-nav-btn${pane === "cleanup" ? " active" : ""}`}
              onClick={() => selectPane("cleanup")}
            >
              Cleanup
            </button>
            {user?.isAdmin ? (
              <button
                type="button"
                className={`settings-nav-btn${pane === "allowlist" ? " active" : ""}`}
                onClick={() => selectPane("allowlist")}
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
