import { useState, type ReactNode } from "react";
import type { ProjectSummary } from "../lib/api";
import { timeAgo } from "../lib/time-ago";
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
  /** Start a job from the open project's brief. */
  onNewJob: () => void;
  busy?: boolean;
  onClose: () => void;
  error?: string | null;
  /** The References, Jobs, or Brief panel for the open project. */
  children?: ReactNode;
};

function lastRun(project: ProjectSummary): string {
  if (!project.lastRunAt) return "no runs";
  const runs = `${project.jobCount} ${project.jobCount === 1 ? "run" : "runs"}`;
  return `${runs} · ${timeAgo(project.lastRunAt)}`;
}

const TAB_LABELS: Record<ProjectPanelView, string> = {
  list: "Projects",
  cast: "References",
  jobs: "Jobs",
  brief: "Brief",
};

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
          ) : (
            <button
              type="button"
              className="primary-btn project-new-job"
              disabled={props.busy}
              title="Start a job from the brief: its prompt, looks, references, and the project model"
              onClick={props.onNewJob}
            >
              New job
            </button>
          )}
          <button type="button" className="gallery-close" aria-label="Close projects" onClick={props.onClose}>
            ×
          </button>
        </div>
      </div>
      {hasProject ? (
        <div className="project-tabs" role="tablist" aria-label="Project panels">
          {(["list", "cast", "jobs", "brief"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={view === tab}
              className={`project-tab${view === tab ? " is-on" : ""}`}
              onClick={() => props.onView(tab)}
            >
              {TAB_LABELS[tab]}
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
              A project keeps a brief and numbered references, ready to generate.
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
