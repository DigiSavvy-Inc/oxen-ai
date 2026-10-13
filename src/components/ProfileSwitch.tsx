import { useEffect, useRef, useState } from "react";
import type { StudioProfile } from "../lib/api";

type Props = {
  profiles: StudioProfile[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

export function ProfileSwitch(props: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = props.profiles.find((profile) => profile.id === props.activeId) ?? props.profiles[0] ?? null;

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!active) return null;

  function close() {
    setOpen(false);
    setDraft("");
    setRenaming(false);
    setConfirmDelete(false);
  }

  return (
    <div className="profile-switch" ref={rootRef}>
      <button
        type="button"
        className={`ghost-btn${open ? " active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {active.name}
      </button>
      {open ? (
        <div className="profile-menu" role="menu" aria-label="Profiles">
          {props.profiles.map((profile) => (
            <button
              key={profile.id}
              type="button"
              role="menuitem"
              className={`profile-option${profile.id === active.id ? " active" : ""}`}
              onClick={() => {
                props.onActivate(profile.id);
                close();
              }}
            >
              {profile.name}
            </button>
          ))}
          {renaming ? (
            <form
              className="profile-create"
              onSubmit={(event) => {
                event.preventDefault();
                const name = renameDraft.trim();
                if (!name) return;
                props.onRename(active.id, name);
                close();
              }}
            >
              <input
                className="field"
                value={renameDraft}
                aria-label="Profile name"
                autoFocus
                onChange={(event) => setRenameDraft(event.target.value)}
              />
            </form>
          ) : (
            <button
              type="button"
              className="profile-option"
              onClick={() => {
                setRenaming(true);
                setRenameDraft(active.name);
                setConfirmDelete(false);
              }}
            >
              Rename
            </button>
          )}
          <form
            className="profile-create"
            onSubmit={(event) => {
              event.preventDefault();
              const name = draft.trim();
              if (!name) return;
              props.onCreate(name);
              close();
            }}
          >
            <input
              className="field"
              value={draft}
              placeholder="New profile"
              aria-label="New profile"
              onChange={(event) => setDraft(event.target.value)}
            />
          </form>
          {props.profiles.length > 1 ? (
            confirmDelete ? (
              <button
                type="button"
                className="profile-option profile-delete"
                onClick={() => {
                  props.onDelete(active.id);
                  close();
                }}
              >
                Delete {active.name}
              </button>
            ) : (
              <button type="button" className="profile-option" onClick={() => setConfirmDelete(true)}>
                Delete
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
