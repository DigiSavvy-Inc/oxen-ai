import { useState, type ReactNode } from "react";
import type { ProjectSummary } from "../lib/api";
import { PanelPlaceSwitch } from "./PanelPlace";
import type { ProjectPanelView } from "./ProjectHeader";

type Props = {
  open: boolean;
  view: ProjectPanelView;
  onView: (view: ProjectPanelView) => void;
  projects: ProjectSummary[];
  activeProjectId: string | null;
  activeProjectName: string | null;
  onCreate: (name: string) => void;
  onOpenProject: (id: string) => void;
  onClose: () => void;
  error?: string | null;
  /** The Cast or Brief panel for the open project. */
  children?: ReactNode;
};

function lastRun(project: ProjectSummary): string {
  const latest = project.sessions.reduce<number>((max, session) => Math.max(max, session.updatedAt), 0);
  if (!latest) return "no runs";
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - latest);
  if (delta < 3600) return `${Math.max(1, Math.floor(delta / 60))}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export function ProjectRail(props: Props) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const hasProject = Boolean(props.activeProjectId);
  const view: ProjectPanelView = hasProject ? props.view : "list";

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
      className={`project-slide${props.open ? " is-open" : ""}${view !== "list" ? " is-project" : ""}`}
      aria-label="Projects"
      inert={props.open ? undefined : true}
    >
      <div className="project-rail-head">
        <strong>{view === "list" ? "Projects" : props.activeProjectName}</strong>
        <div className="project-rail-head-actions">
          <PanelPlaceSwitch />
          {view === "list" ? (
            <button type="button" className="ghost-btn" onClick={() => setNaming((value) => !value)}>
              New
            </button>
          ) : null}
          <button type="button" className="gallery-close" aria-label="Close projects" onClick={props.onClose}>
            ×
          </button>
        </div>
      </div>
      {hasProject ? (
        <div className="project-tabs" role="tablist" aria-label="Project panels">
          {(["list", "cast", "brief"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={view === tab}
              className={`project-tab${view === tab ? " is-on" : ""}`}
              onClick={() => props.onView(tab)}
            >
              {tab === "list" ? "Projects" : tab === "cast" ? "Cast" : "Brief"}
            </button>
          ))}
        </div>
      ) : null}
      {view === "list" ? (
        <>
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
            <p className="project-rail-empty">
              A project keeps a brief and a numbered cast of references, ready to generate.
            </p>
          ) : (
            <ul className="project-rail-list">
              {props.projects.map((project) => (
                <li key={project.id}>
                  <button
                    type="button"
                    className={`project-rail-row project-rail-open${props.activeProjectId === project.id ? " is-active" : ""}`}
                    onClick={() => props.onOpenProject(project.id)}
                  >
                    <span className="project-rail-title">{project.name}</span>
                    <span className="project-rail-meta">
                      {project.castCount} {project.castCount === 1 ? "ref" : "refs"} · {lastRun(project)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        props.children
      )}
    </aside>
  );
}
