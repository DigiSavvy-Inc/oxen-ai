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
  const [renamingId, setRenamingId] = useState<string | null>(null);
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
      if (event.key !== "Escape") return;
      if (renamingId) {
        setRenamingId(null);
        return;
      }
      setOpen(false);
    }
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, renamingId]);

  if (!active) return null;

  function close() {
    setOpen(false);
    setDraft("");
    setRenamingId(null);
    setConfirmDelete(false);
  }

  function commitRename(id: string) {
    const name = renameDraft.trim();
    const profile = props.profiles.find((item) => item.id === id);
    if (!name || !profile || name === profile.name) {
      setRenamingId(null);
      return;
    }
    props.onRename(id, name);
    setRenamingId(null);
  }

  return (
    <div className="profile-switch" ref={rootRef}>
      <div className={`profile-chip${open ? " is-open" : ""}`}>
        <span className="profile-name">{active.name}</span>
        <span className="profile-chip-rule" aria-hidden="true">
          |
        </span>
        <button
          type="button"
          className="profile-switch-btn"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            setRenamingId(null);
            setOpen((value) => !value);
          }}
        >
          Switch profile
          <SwitchIcon />
        </button>
      </div>
      {open ? (
        <div className="profile-menu" role="menu" aria-label="Profiles">
          {props.profiles.map((profile) =>
            renamingId === profile.id ? (
              <form
                key={profile.id}
                className="profile-row-editor"
                onSubmit={(event) => {
                  event.preventDefault();
                  commitRename(profile.id);
                }}
              >
                <input
                  className="field"
                  value={renameDraft}
                  aria-label="Profile name"
                  autoFocus
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    event.stopPropagation();
                    setRenamingId(null);
                  }}
                />
                <button type="submit" className="prompt-action" disabled={!renameDraft.trim()}>
                  Save changes
                </button>
              </form>
            ) : (
              <div key={profile.id} className="profile-row">
                <button
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
                <button
                  type="button"
                  className="saved-prompt-edit"
                  aria-label={`Edit ${profile.name}`}
                  onClick={() => {
                    setRenameDraft(profile.name);
                    setRenamingId(profile.id);
                    setConfirmDelete(false);
                  }}
                >
                  <PencilIcon />
                  Edit
                </button>
              </div>
            ),
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

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M9.2 3.1 12.9 6.8M3 13l.8-3.1L11.4 2.3a1.1 1.1 0 0 1 1.6 0l.7.7a1.1 1.1 0 0 1 0 1.6L5.1 12.2 3 13z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SwitchIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        d="M2.5 5.2h9.2M9.4 2.8 12.2 5.2 9.4 7.6M13.5 10.8H4.3M6.6 8.4 3.8 10.8 6.6 13.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
