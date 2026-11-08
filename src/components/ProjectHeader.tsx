import type { StudioProject } from "../lib/api";
import { castSummaryLabel, type CastSelection } from "../lib/cast";

export type ProjectPanelView = "list" | "cast" | "jobs" | "brief";

type Props = {
  project: StudioProject;
  selection: CastSelection;
  galleryCount: number;
  view: ProjectPanelView | null;
  onOpen: (view: ProjectPanelView) => void;
  onClose: () => void;
};

function lastRunLabel(project: StudioProject): string {
  const latest = project.lastRunAt ?? 0;
  if (!latest) return "No runs yet";
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - latest);
  if (delta < 60) return "Ran just now";
  if (delta < 3600) return `Ran ${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `Ran ${Math.floor(delta / 3600)}h ago`;
  return `Ran ${Math.floor(delta / 86400)}d ago`;
}

export function ProjectHeader(props: Props) {
  const refs = props.selection.total;
  const galleries = props.galleryCount;
  const attached = castSummaryLabel(props.selection);
  const overBudget = props.selection.attached.length < refs;
  return (
    <header className="project-header" aria-label={`Project ${props.project.name}`}>
      <div className="project-header-copy">
        <strong className="project-header-name">{props.project.name}</strong>
        <span className="project-header-meta">
          {refs} {refs === 1 ? "ref" : "refs"} · {galleries} {galleries === 1 ? "gallery" : "galleries"} ·{" "}
          <button
            type="button"
            className={`project-header-attached${overBudget ? " is-partial" : ""}`}
            title="Open the cast to choose which references are active"
            onClick={() => props.onOpen("cast")}
          >
            {attached}
          </button>{" "}
          ·{" "}
          <button
            type="button"
            className="project-header-attached"
            title="Open the jobs list"
            onClick={() => props.onOpen("jobs")}
          >
            {lastRunLabel(props.project)}
          </button>
        </span>
      </div>
      <div className="project-header-actions">
        <button
          type="button"
          className={`ghost-btn${props.view === "cast" ? " active" : ""}`}
          aria-pressed={props.view === "cast"}
          onClick={() => props.onOpen("cast")}
        >
          Cast
        </button>
        <button
          type="button"
          className={`ghost-btn${props.view === "jobs" ? " active" : ""}`}
          aria-pressed={props.view === "jobs"}
          onClick={() => props.onOpen("jobs")}
        >
          Jobs
        </button>
        <button
          type="button"
          className={`ghost-btn${props.view === "brief" ? " active" : ""}`}
          aria-pressed={props.view === "brief"}
          onClick={() => props.onOpen("brief")}
        >
          Brief
        </button>
        <button type="button" className="gallery-close" aria-label="Close project" title="Close project" onClick={props.onClose}>
          ×
        </button>
      </div>
    </header>
  );
}
