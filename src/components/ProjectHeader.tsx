import type { StudioProject } from "../lib/api";
import { castSummaryLabel, type CastSelection } from "../lib/cast";
import { ORIGIN_LABELS, type ComposerOrigin } from "../lib/project-model";
import { timeAgo } from "../lib/time-ago";

export type ProjectPanelView = "list" | "cast" | "jobs" | "brief";

type Props = {
  project: StudioProject;
  selection: CastSelection;
  galleryCount: number;
  view: ProjectPanelView | null;
  /** What the composer holds right now: last visit's draft, or a job started from the brief. */
  origin: ComposerOrigin;
  busy: boolean;
  onOpen: (view: ProjectPanelView) => void;
  onNewJob: () => void;
  onClose: () => void;
  slotHandles?: string[];
  onOpenSlots?: () => void;
};

function lastRunLabel(project: StudioProject): string {
  const latest = project.lastRunAt ?? 0;
  if (!latest) return "No runs yet";
  return `Ran ${timeAgo(latest)}`;
}

export function ProjectHeader(props: Props) {
  const refs = props.selection.total;
  const galleries = props.galleryCount;
  const attached = castSummaryLabel(props.selection);
  const overBudget = props.selection.attached.length < refs;
  return (
    <header className="project-header" aria-label={`Project ${props.project.name}`}>
      <div className="project-header-copy">
        <strong className="project-header-name">
          {props.project.name}
          <span
            className={`project-origin is-${props.origin}`}
            title={
              props.origin === "draft"
                ? "The composer is showing the draft from your last visit"
                : "The composer started from the brief"
            }
          >
            {ORIGIN_LABELS[props.origin]}
          </span>
        </strong>
        <span className="project-header-meta">
          {refs} {refs === 1 ? "ref" : "refs"} · {galleries} {galleries === 1 ? "gallery" : "galleries"} ·{" "}
          <button
            type="button"
            className={`project-header-attached${overBudget ? " is-partial" : ""}`}
            title="Open the references to choose which are active"
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
          {props.onOpenSlots ? (
            <>
              {" "}
              ·{" "}
              <button
                type="button"
                className="project-header-attached"
                title="Open slots"
                onClick={props.onOpenSlots}
              >
                {props.slotHandles && props.slotHandles.length > 0
                  ? `Slots ${props.slotHandles.map((handle) => `@${handle}`).join(" ")}`
                  : "Slots"}
              </button>
            </>
          ) : null}
        </span>
      </div>
      <div className="project-header-actions">
        <button
          type="button"
          className="primary-btn project-new-job"
          disabled={props.busy}
          title="Start a job from the brief: its prompt, looks, references, and the project model"
          onClick={props.onNewJob}
        >
          New job
        </button>
        <button
          type="button"
          className={`ghost-btn${props.view === "cast" ? " active" : ""}`}
          aria-pressed={props.view === "cast"}
          onClick={() => props.onOpen("cast")}
        >
          References
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
