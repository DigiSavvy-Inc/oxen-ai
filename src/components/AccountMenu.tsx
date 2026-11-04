import { useEffect, useRef, useState } from "react";
import type { StudioProfile } from "../lib/api";
import { ProfileSwitch } from "./ProfileSwitch";

export function AccountMenu({
  userLogin,
  avatarUrl,
  isAdmin,
  hasOxenKey,
  onOpenSettings,
  onLogout,
  profiles,
  activeProfileId,
  onActivateProfile,
  onCreateProfile,
  onRenameProfile,
  onDeleteProfile,
}: {
  userLogin: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  hasOxenKey: boolean;
  onOpenSettings: () => void;
  onLogout: () => void;
  profiles: StudioProfile[];
  activeProfileId: string | null;
  onActivateProfile: (id: string) => void;
  onCreateProfile: (name: string) => void;
  onRenameProfile: (id: string, name: string) => void;
  onDeleteProfile: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0] ?? null;

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setOpen(false);
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
        aria-label={
          activeProfile
            ? `Account menu for @${userLogin}, profile ${activeProfile.name}`
            : `Account menu for @${userLogin}`
        }
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
              {activeProfile ? `${activeProfile.name} · ` : ""}
              {hasOxenKey ? "Oxen key ready" : "Add Oxen key in Settings"}
              {isAdmin ? " · admin" : ""}
            </div>
          </div>
          <ProfileSwitch
            profiles={profiles}
            activeId={activeProfileId}
            onActivate={onActivateProfile}
            onCreate={onCreateProfile}
            onRename={onRenameProfile}
            onDelete={onDeleteProfile}
            onDismiss={() => setOpen(false)}
          />
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
