import { useEffect, useRef, useState } from "react";

export function AccountMenu({
  userLogin,
  avatarUrl,
  isAdmin,
  hasOxenKey,
  onOpenSettings,
  onLogout,
}: {
  userLogin: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  hasOxenKey: boolean;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        className="account-menu-hit"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for @${userLogin}`}
        aria-keyshortcuts="Meta+Shift+Comma"
        title="Settings (⌘⇧,)"
        onClick={() => setOpen((value) => !value)}
      >
        {avatarUrl ? <img src={avatarUrl} alt="" /> : <span className="account-menu-fallback">?</span>}
      </button>
      {open ? (
        <div className="account-menu-pop" role="menu">
          <div className="account-menu-meta">
            <div className="name">@{userLogin}</div>
            <div className="role">
              {hasOxenKey ? "Oxen key ready" : "Add Oxen key in Settings"}
              {isAdmin ? " · admin" : ""}
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
          >
            Settings
            <span className="menu-shortcut" aria-hidden>
              <kbd>⌘</kbd>
              <kbd>⇧</kbd>
              <kbd>,</kbd>
            </span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}
