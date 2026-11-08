import { useEffect, useState } from "react";
import type { StudioLook, StudioProject } from "../lib/api";
import { appliedLooks, PROJECT_LOOKS_MAX, sortLooks } from "../../worker/looks";

type Props = {
  project: StudioProject;
  looks: StudioLook[];
  /** Looks applied in the composer, in chip order. Saving the brief keeps them on the project. */
  lookIds: string[];
  onToggleLook: (id: string) => void;
  /** The composer prompt. The brief edits the same text the composer shows. */
  prompt: string;
  onPromptChange: (prompt: string) => void;
  busy: boolean;
  error: string | null;
  dirty: boolean;
  onSave: (body: { name: string }) => void;
  onDelete: () => void;
  onShare: (days: number | null) => void;
  onRevoke: (shareId: string) => void;
  activeSessionId: string | null;
  onOpenSession: (sessionId: string) => void;
  onNewSession: () => void;
};

export function ProjectBrief(props: Props) {
  const [name, setName] = useState(props.project.name);
  const [days, setDays] = useState("7");
  const chosenLooks = appliedLooks(props.lookIds, props.looks);
  const lookOptions = sortLooks(props.looks).filter((look) => !props.lookIds.includes(look.id));

  useEffect(() => {
    setName(props.project.name);
  }, [props.project.id, props.project.name]);

  const nameChanged = name.trim() !== props.project.name;
  const canSave = !props.busy && Boolean(name.trim()) && (props.dirty || nameChanged);

  return (
    <section className="project-brief" aria-label={`Brief for ${props.project.name}`}>
      <label>
        Name
        <input className="field" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Prompt
        <textarea
          className="field project-brief-prompt"
          rows={6}
          value={props.prompt}
          maxLength={8000}
          placeholder="The part that stays the same across scenes: the mentions, the staging, the style notes."
          onChange={(event) => props.onPromptChange(event.target.value)}
        />
      </label>
      <p className="project-rail-empty">
        This is the composer prompt. Save to keep it as the project’s brief.
      </p>
      <div className="project-editor-look">
        <div className="project-editor-head">
          <h3>Looks</h3>
          <span className="project-rail-empty">
            {chosenLooks.length} of {PROJECT_LOOKS_MAX}
          </span>
        </div>
        {chosenLooks.length === 0 ? (
          <p className="project-rail-empty">No looks applied. Looks go ahead of the prompt, in this order.</p>
        ) : (
          <ul className="look-chips" aria-label="Applied looks">
            {chosenLooks.map((look, index) => (
              <li key={look.id} className="look-chip" title={look.body}>
                <span className="look-chip-index" aria-hidden>
                  {index + 1}
                </span>
                <span className="look-chip-name">{look.name}</span>
                <button
                  type="button"
                  className="look-chip-remove"
                  aria-label={`Remove look ${look.name}`}
                  onClick={() => props.onToggleLook(look.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <select
          className="field"
          aria-label="Add a look"
          value=""
          disabled={lookOptions.length === 0 || props.lookIds.length >= PROJECT_LOOKS_MAX}
          onChange={(event) => {
            if (event.target.value) props.onToggleLook(event.target.value);
          }}
        >
          <option value="">
            {props.looks.length === 0
              ? "Save a look from the composer first"
              : props.lookIds.length >= PROJECT_LOOKS_MAX
                ? `${PROJECT_LOOKS_MAX} looks is the limit`
                : "Add a look…"}
          </option>
          {lookOptions.map((look) => (
            <option key={look.id} value={look.id}>
              {look.starred ? "★ " : ""}
              {look.name}
              {look.group ? ` · ${look.group}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="project-editor-share project-brief-sessions">
        <div className="project-editor-head">
          <h3>Sessions</h3>
          <button type="button" className="ghost-btn" disabled={props.busy} onClick={props.onNewSession}>
            New session
          </button>
        </div>
        {props.project.sessions.length === 0 ? (
          <p>Generate to save a session. Runs move to a Jobs view soon.</p>
        ) : (
          <ul>
            {props.project.sessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  className={`project-session${props.activeSessionId === session.id ? " is-active" : ""}`}
                  onClick={() => props.onOpenSession(session.id)}
                >
                  {session.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="project-editor-share">
        <h3>Share link</h3>
        <p>Someone signed in can generate with this brief and cast. They cannot change this project.</p>
        <div className="project-editor-share-row">
          <select className="field" value={days} aria-label="Share expiry" onChange={(event) => setDays(event.target.value)}>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="">Until I revoke it</option>
          </select>
          <button
            type="button"
            className="ghost-btn"
            disabled={props.busy}
            onClick={() => props.onShare(days ? Number(days) : null)}
          >
            Create link
          </button>
        </div>
        <ul>
          {props.project.shares.map((share) => {
            const closed = share.revokedAt != null || (share.expiresAt != null && share.expiresAt * 1000 <= Date.now());
            const href = `${window.location.origin}/?share=${share.token}`;
            return (
              <li key={share.id}>
                <a href={href}>{closed ? "Closed" : "Open link"}</a>
                {share.revokedAt == null ? (
                  <button type="button" className="ghost-btn" onClick={() => props.onRevoke(share.id)}>
                    Revoke
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
      {props.error ? <p className="settings-bad">{props.error}</p> : null}
      <div className="modal-actions">
        <button type="button" className="gallery-delete" disabled={props.busy} onClick={props.onDelete}>
          Delete project
        </button>
        <button
          type="button"
          className="primary-btn"
          disabled={!canSave}
          onClick={() => props.onSave({ name: name.trim() })}
        >
          Save brief
        </button>
      </div>
    </section>
  );
}
