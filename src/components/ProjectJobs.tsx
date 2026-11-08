import { useMemo, useState } from "react";
import { mentionChipLabel, mentionToken, type Generation, type ProjectJob, type ProjectJobOutput } from "../lib/api";
import {
  castFilesForJob,
  filterJobs,
  jobCostLabel,
  jobModeLabel,
  jobModelLabel,
  jobPromptExcerpt,
  jobSettingRows,
  jobStatusLabel,
  jobTimeLabel,
  mergeJobOutputs,
  type JobFilter,
} from "../lib/project-jobs";
import { jobStatus } from "../../worker/job-record";
import { referenceRoleLabel } from "../../worker/schema";
import { GalleryThumb } from "./GalleryThumb";
import { Loader } from "./Loader";

type Props = {
  jobs: ProjectJob[];
  loading: boolean;
  error: string | null;
  notice: string | null;
  busy: boolean;
  /** Generations the app is polling, so a running job updates in place. */
  live: ReadonlyMap<string, Generation>;
  /** Catalog display names by model id; ids not in the catalog get a derived label. */
  modelNames: ReadonlyMap<string, string>;
  onRerun: (job: ProjectJob) => void;
  onLoad: (job: ProjectJob) => void;
  onAddOutputs: (job: ProjectJob, outputs: ProjectJobOutput[]) => void;
  onOpenOutput: (output: ProjectJobOutput) => void;
  onDownload: (job: ProjectJob, output: ProjectJobOutput) => void;
  onRefresh: () => void;
};

function outputPreview(output: ProjectJobOutput): string {
  if (output.mediaType === "image") return output.thumbUrl || output.resultUrl || "";
  return output.thumbUrl || output.resultUrl || "";
}

function outputKind(output: ProjectJobOutput): "image" | "video" | "audio" {
  return output.mediaType === "video" || output.mediaType === "audio" ? output.mediaType : "image";
}

export function ProjectJobs(props: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<JobFilter>({ model: "", status: "" });
  const models = useMemo(() => [...new Set(props.jobs.map((job) => job.model))].sort(), [props.jobs]);
  const shown = filterJobs(props.jobs, filter);
  const modelLabel = (model: string) => props.modelNames.get(model) ?? jobModelLabel(model);

  function renderOutputs(job: ProjectJob, outputs: ProjectJobOutput[], expanded: boolean) {
    return (
      <div className={`job-outputs${expanded ? " is-large" : ""}`}>
        {outputs.map((output) => {
          const preview = outputPreview(output);
          const finished = output.status === "succeeded" && Boolean(output.resultUrl);
          const failed = output.status === "failed" || output.status === "cancelled";
          return (
            <div key={output.id} className={`job-output${failed ? " is-failed" : ""}`}>
              <button
                type="button"
                className="job-output-media"
                title={
                  finished
                    ? "Open in the canvas"
                    : failed
                      ? output.errorMessage || jobStatusLabel(output.status === "cancelled" ? "cancelled" : "failed")
                      : "Still running"
                }
                disabled={!finished}
                onClick={() => props.onOpenOutput(output)}
              >
                {finished && preview ? (
                  <GalleryThumb kind={outputKind(output)} name={job.model} preview={preview} slot="tile" />
                ) : failed ? (
                  <span className="job-output-state">{output.status === "cancelled" ? "Cancelled" : "Failed"}</span>
                ) : (
                  <Loader size="sm" label="Generating" />
                )}
              </button>
              {expanded && finished ? (
                <button
                  type="button"
                  className="ghost-btn job-output-download"
                  onClick={() => props.onDownload(job, output)}
                >
                  Download
                </button>
              ) : null}
              {expanded && failed && output.errorMessage ? (
                <span className="job-output-error">{output.errorMessage}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <section className="jobs-panel" aria-label="Jobs">
      <div className="jobs-filters">
        <select
          className="field"
          aria-label="Filter by model"
          value={filter.model}
          onChange={(event) => setFilter((prev) => ({ ...prev, model: event.target.value }))}
        >
          <option value="">All models</option>
          {models.map((model) => (
            <option key={model} value={model}>
              {modelLabel(model)}
            </option>
          ))}
        </select>
        <select
          className="field"
          aria-label="Filter by status"
          value={filter.status}
          onChange={(event) =>
            setFilter((prev) => ({ ...prev, status: event.target.value as JobFilter["status"] }))
          }
        >
          <option value="">Any status</option>
          <option value="done">Done</option>
          <option value="running">Running</option>
          <option value="failed">Failed</option>
        </select>
        <button type="button" className="ghost-btn" disabled={props.loading} onClick={props.onRefresh}>
          Refresh
        </button>
      </div>
      {props.notice ? <p className="cast-notice" role="status">{props.notice}</p> : null}
      {props.error ? <p className="settings-bad">{props.error}</p> : null}
      {props.loading && props.jobs.length === 0 ? (
        <div className="jobs-loading">
          <Loader size="sm" label="Loading jobs" />
        </div>
      ) : null}
      {!props.loading && props.jobs.length === 0 && !props.error ? (
        <p className="project-rail-empty">
          No runs yet. Generate from this project and each batch shows up here with the prompt, the references, and the
          settings it was sent with.
        </p>
      ) : null}
      {props.jobs.length > 0 && shown.length === 0 ? (
        <p className="project-rail-empty">No runs match those filters.</p>
      ) : null}
      <ul className="job-list">
        {shown.map((job) => {
          const outputs = mergeJobOutputs(job, props.live);
          const status = jobStatus(outputs.map((output) => output.status));
          const expanded = openId === job.batchId;
          const castFiles = castFilesForJob(job, outputs);
          const settingRows = jobSettingRows(job.settings);
          return (
            <li key={job.batchId} className={`job-row${expanded ? " is-open" : ""}`}>
              <button
                type="button"
                className="job-summary"
                aria-expanded={expanded}
                onClick={() => setOpenId(expanded ? null : job.batchId)}
              >
                <span className="job-thumbs">
                  {outputs.slice(0, 4).map((output) => {
                    const preview = outputPreview(output);
                    const finished = output.status === "succeeded" && preview;
                    return (
                      <span key={output.id} className={`job-thumb${finished ? "" : " is-pending"}`}>
                        {finished ? (
                          <GalleryThumb kind={outputKind(output)} name={job.model} preview={preview} slot="strip" />
                        ) : output.status === "failed" || output.status === "cancelled" ? (
                          <span className="job-thumb-x" aria-hidden>
                            ×
                          </span>
                        ) : (
                          <Loader size="sm" />
                        )}
                      </span>
                    );
                  })}
                </span>
                <span className="job-copy">
                  <span className="job-excerpt">{jobPromptExcerpt(job)}</span>
                  <span className="job-meta">
                    {modelLabel(job.model)} · {jobModeLabel(job.mode)}
                    {job.cost != null ? ` · ${jobCostLabel(job.cost)}` : ""} · {jobTimeLabel(job.createdAt)}
                  </span>
                </span>
                <span className={`job-status is-${status}`}>{jobStatusLabel(status)}</span>
              </button>
              {expanded ? (
                <div className="job-detail">
                  <div className="job-actions">
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={props.busy}
                      title="Send the same request again, one output"
                      onClick={() => props.onRerun(job)}
                    >
                      Re-run
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={props.busy}
                      title="Put this prompt, these looks, the model, and the settings back in the composer"
                      onClick={() => props.onLoad(job)}
                    >
                      Load into composer
                    </button>
                    <button
                      type="button"
                      className="ghost-btn"
                      disabled={props.busy || castFiles.length === 0}
                      title={
                        castFiles.length === 0
                          ? "Finished outputs can join the cast"
                          : `Add ${castFiles.length} ${castFiles.length === 1 ? "output" : "outputs"} to the cast, taking the next numbers`
                      }
                      onClick={() => props.onAddOutputs(job, outputs)}
                    >
                      Add outputs to cast
                    </button>
                  </div>
                  <h4 className="job-heading">Sent</h4>
                  <pre className="job-prompt">{job.prompt}</pre>
                  {job.looks.length > 0 ? (
                    <ul className="look-chips job-looks" aria-label="Looks applied">
                      {job.looks.map((look, index) => (
                        <li key={look.id} className="look-chip">
                          <span className="look-chip-index" aria-hidden>
                            {index + 1}
                          </span>
                          <span className="look-chip-name">{look.name}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {job.refs.length > 0 ? (
                    <>
                      <h4 className="job-heading">References</h4>
                      <ul className="job-refs" aria-label="References as sent">
                        {job.refs.map((ref) => {
                          const token = mentionToken(ref.kind, ref.number - 1);
                          return (
                            <li key={`${ref.kind}-${ref.number}-${ref.key}`} className="job-ref" title={ref.name}>
                              <span className="job-ref-media">
                                {ref.url ? (
                                  <GalleryThumb kind={ref.kind} name={ref.name} preview={ref.thumbUrl || ref.url} slot="strip" />
                                ) : (
                                  <span className="job-output-state">Gone</span>
                                )}
                              </span>
                              <span className="job-ref-number">{mentionChipLabel(token)}</span>
                              <span className="job-ref-role">
                                {ref.kind === "audio" ? "Audio" : referenceRoleLabel(ref.role)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : null}
                  <h4 className="job-heading">Settings</h4>
                  <dl className="job-settings">
                    <div>
                      <dt>Model</dt>
                      <dd>{modelLabel(job.model)}</dd>
                    </div>
                    <div>
                      <dt>Mode</dt>
                      <dd>{jobModeLabel(job.mode)}</dd>
                    </div>
                    {settingRows.map((row) => (
                      <div key={row.label}>
                        <dt>{row.label}</dt>
                        <dd>{row.value}</dd>
                      </div>
                    ))}
                    <div>
                      <dt>Cost</dt>
                      <dd>{job.cost != null ? jobCostLabel(job.cost) : "—"}</dd>
                    </div>
                    <div>
                      <dt>Run</dt>
                      <dd>
                        {new Date(job.createdAt * 1000).toLocaleString(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </dd>
                    </div>
                  </dl>
                  <h4 className="job-heading">Outputs</h4>
                  {renderOutputs(job, outputs, true)}
                  {outputs.some((output) => output.tags.length > 0) ? (
                    <p className="job-tags">
                      Tags: {[...new Set(outputs.flatMap((output) => output.tags))].join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
