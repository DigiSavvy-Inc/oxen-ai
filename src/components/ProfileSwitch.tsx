import { useState } from "react";
import type { StudioProfile } from "../lib/api";

type Props = {
  profiles: StudioProfile[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDismiss?: () => void;
};

export function ProfileSwitch(props: Props) {
  const [draft, setDraft] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = props.profiles.find((profile) => profile.id === props.activeId) ?? props.profiles[0] ?? null;

  if (!active) return null;

  function close() {
    setDraft("");
    setRenamingId(null);
    setConfirmDelete(false);
    props.onDismiss?.();
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
    <div className="account-profiles">
      <div className="account-profiles-label">Switch profile</div>
      <div role="group" aria-label="Profiles">
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
                  Save
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

