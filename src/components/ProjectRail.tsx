import { useState, type ReactNode } from "react";
import type { GallerySummary, ProjectSummary, StudioProject, StudioStyle } from "../lib/api";
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
  styles: StudioStyle[];
  galleries: GallerySummary[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (body: {
    name: string;
    prompt: string;
    styleId: string | null;
    media: StudioProject["media"];
    galleryIds: string[];
  }) => void;
  onCreateStyle: (name: string, body: string) => Promise<{ id: string } | null>;
  onPinComposer: () => Promise<StudioProject["media"]>;
  onDelete: () => void;
  onShare: (days: number | null) => void;
  onRevoke: (shareId: string) => void;
}) {
  const [name, setName] = useState(props.project.name);
  const [prompt, setPrompt] = useState(props.project.prompt);
  const [styleId, setStyleId] = useState(props.project.styleId ?? "");
  const [media, setMedia] = useState(props.project.media);
  const [galleryIds, setGalleryIds] = useState(props.project.galleryIds);
  const [lookName, setLookName] = useState("");
  const [lookBody, setLookBody] = useState("");
  const [days, setDays] = useState("7");

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
      <label>
        Default look
        <select className="field" value={styleId} onChange={(event) => setStyleId(event.target.value)}>
          <option value="">None</option>
          {props.styles.map((style) => (
            <option key={style.id} value={style.id}>
              {style.name}
            </option>
          ))}
        </select>
      </label>
      <div className="project-editor-look">
        <input
          className="field"
          value={lookName}
          placeholder="Look name"
          aria-label="Look name"
          onChange={(event) => setLookName(event.target.value)}
        />
        <textarea
          className="field"
          rows={2}
          value={lookBody}
          placeholder="35mm, or a 2000s camcorder"
          aria-label="Look description"
          onChange={(event) => setLookBody(event.target.value)}
        />
        <button
          type="button"
          className="ghost-btn"
          disabled={props.busy || !lookName.trim() || !lookBody.trim()}
          onClick={() => {
            void props.onCreateStyle(lookName.trim(), lookBody.trim()).then((style) => {
              if (style) setStyleId(style.id);
              setLookName("");
              setLookBody("");
            });
          }}
        >
          Save look
        </button>
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
              styleId: styleId || null,
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
