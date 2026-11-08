import { useState, type ReactNode } from "react";
import type { GallerySummary, ProjectSummary, StudioLook, StudioProject } from "../lib/api";
import { appliedLooks, PROJECT_LOOKS_MAX, sortLooks, toggleLookId } from "../../worker/looks";
import { PanelPlaceSwitch } from "./PanelPlace";

type Props = {
  open: boolean;
  projects: ProjectSummary[];
  activeProjectId: string | null;
  activeSessionId: string | null;
  onCreate: (name: string) => void;
  onOpenProject: (id: string) => void;
  onOpenSession: (projectId: string, sessionId: string) => void;
  onNewSession: () => void;
  onEdit: (id: string) => void;
  onOpenGallery: (galleryId: string) => void;
  onClose: () => void;
  linkedGalleries: { id: string; name: string }[];
  error?: string | null;
  children?: ReactNode;
};

export function ProjectRail(props: Props) {
  const [expanded, setExpanded] = useState<string | null>(props.activeProjectId);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const openId = expanded ?? props.activeProjectId;

  function create() {
    const next = name.trim();
    if (!next) return;
    props.onCreate(next);
    setName("");
    setNaming(false);
  }

  return (
    <aside
      id="project-slide"
      className={`project-slide${props.open ? " is-open" : ""}`}
      aria-label="Projects"
      inert={props.open ? undefined : true}
    >
      <div className="project-rail-head">
        <strong>Projects</strong>
        <div className="project-rail-head-actions">
          <PanelPlaceSwitch />
          <button type="button" className="ghost-btn" onClick={() => setNaming((value) => !value)}>
            New
          </button>
          <button type="button" className="gallery-close" aria-label="Close projects" onClick={props.onClose}>
            ×
          </button>
        </div>
      </div>
      {naming ? (
        <form
          className="project-rail-name"
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <input
            className="field"
            value={name}
            placeholder="Project name"
            aria-label="Project name"
            autoFocus
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="ghost-btn">
            Add
          </button>
        </form>
      ) : null}
      {props.error ? <p className="settings-bad">{props.error}</p> : null}
      {props.projects.length === 0 ? (
        <p className="project-rail-empty">A project keeps a prompt, a look, and the media you reuse.</p>
      ) : (
        <ul className="project-rail-list">
          {props.projects.map((project) => {
            const isOpen = openId === project.id;
            return (
              <li key={project.id}>
                <div className={`project-rail-row${props.activeProjectId === project.id ? " is-active" : ""}`}>
                  <button
                    type="button"
                    className="project-rail-expand"
                    aria-expanded={isOpen}
                    aria-label={`${isOpen ? "Collapse" : "Expand"} ${project.name}`}
                    onClick={() => setExpanded(isOpen ? null : project.id)}
                  >
                    {isOpen ? "▾" : "▸"}
                  </button>
                  <button type="button" className="project-rail-title" onClick={() => props.onOpenProject(project.id)}>
                    {project.name}
                  </button>
                </div>
                {isOpen ? (
                  <div className="project-rail-sessions">
                    <button type="button" className="ghost-btn" onClick={() => props.onEdit(project.id)}>
                      Defaults
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={props.activeProjectId !== project.id}
                      onClick={props.onNewSession}
                    >
                      New session
                    </button>
                    {project.sessions.length === 0 ? (
                      <p className="project-rail-empty">Generate to save a session.</p>
                    ) : (
                      project.sessions.map((session) => (
                        <button
                          key={session.id}
                          type="button"
                          className={`project-session${props.activeSessionId === session.id ? " is-active" : ""}`}
                          onClick={() => props.onOpenSession(project.id, session.id)}
                        >
                          {session.name}
                        </button>
                      ))
                    )}
                    {props.activeProjectId === project.id && props.linkedGalleries.length > 0 ? (
                      <div className="project-rail-galleries">
                        {props.linkedGalleries.map((gallery) => (
                          <button
                            key={gallery.id}
                            type="button"
                            className="project-session"
                            onClick={() => props.onOpenGallery(gallery.id)}
                          >
                            {gallery.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {props.children}
    </aside>
  );
}

export function ProjectEditor(props: {
  project: StudioProject;
  looks: StudioLook[];
  galleries: GallerySummary[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (body: {
    name: string;
    prompt: string;
    lookIds: string[];
    media: StudioProject["media"];
    galleryIds: string[];
  }) => void;
  onPinComposer: () => Promise<StudioProject["media"]>;
  onDelete: () => void;
  onShare: (days: number | null) => void;
  onRevoke: (shareId: string) => void;
}) {
  const [name, setName] = useState(props.project.name);
  const [prompt, setPrompt] = useState(props.project.prompt);
  const [lookIds, setLookIds] = useState(props.project.lookIds);
  const [media, setMedia] = useState(props.project.media);
  const [galleryIds, setGalleryIds] = useState(props.project.galleryIds);
  const [days, setDays] = useState("7");
  const chosenLooks = appliedLooks(lookIds, props.looks);
  const lookOptions = sortLooks(props.looks).filter((look) => !lookIds.includes(look.id));

  function toggleGallery(id: string) {
    setGalleryIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  }

  return (
    <section className="project-editor" aria-label={`Defaults for ${props.project.name}`}>
      <div className="project-editor-head">
        <h2>Project defaults</h2>
        <button type="button" className="gallery-close" aria-label="Close project defaults" onClick={props.onClose}>
          ×
        </button>
      </div>
      <label>
        Name
        <input className="field" value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Default prompt
        <textarea className="field" rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      </label>
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
                  onClick={() => setLookIds((prev) => prev.filter((id) => id !== look.id))}
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
          disabled={lookOptions.length === 0 || lookIds.length >= PROJECT_LOOKS_MAX}
          onChange={(event) => {
            if (event.target.value) setLookIds((prev) => toggleLookId(prev, event.target.value));
          }}
        >
          <option value="">
            {props.looks.length === 0
              ? "Save a look from the composer first"
              : lookIds.length >= PROJECT_LOOKS_MAX
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
      <div className="project-editor-media">
        <div className="project-editor-head">
          <h3>Pinned media</h3>
          <button
            type="button"
            className="ghost-btn"
            disabled={props.busy}
            onClick={() => {
              void props.onPinComposer().then((next) => setMedia(next));
            }}
          >
            Pin composer files
          </button>
        </div>
        {media.length === 0 ? (
          <p className="project-rail-empty">Nothing pinned. Files in the composer can be saved here.</p>
        ) : (
          <ul>
            {media.map((item) => (
              <li key={item.key}>
                <span>{item.name}</span>
                <button type="button" className="ghost-btn" onClick={() => setMedia((prev) => prev.filter((entry) => entry.key !== item.key))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <fieldset className="project-editor-galleries">
        <legend>Galleries</legend>
        {props.galleries.length === 0 ? (
          <p className="project-rail-empty">No galleries in this profile yet.</p>
        ) : (
          props.galleries.map((gallery) => (
            <label key={gallery.id}>
              <input
                type="checkbox"
                checked={galleryIds.includes(gallery.id)}
                onChange={() => toggleGallery(gallery.id)}
              />
              {gallery.name}
            </label>
          ))
        )}
      </fieldset>
      <div className="project-editor-share">
        <h3>Share link</h3>
        <p>Someone signed in can generate with these defaults. They cannot change this project.</p>
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
          disabled={props.busy || !name.trim()}
          onClick={() =>
            props.onSave({
              name: name.trim(),
              prompt,
              lookIds,
              media,
              galleryIds,
            })
          }
        >
          Save defaults
        </button>
      </div>
    </section>
  );
}
