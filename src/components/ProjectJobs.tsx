import { useEffect, useMemo, useRef, useState } from "react";
import {
  mentionChipLabel,
  mentionToken,
  type Generation,
  type ProjectJob,
  type ProjectJobOutput,
  type ProjectJobRef,
} from "../lib/api";
import {
  castFilesForJob,
  filterJobs,
  jobCostLabel,
  jobDurationLabel,
  jobErrorText,
  jobExactTime,
  jobModeLabel,
  jobModelLabel,
  jobOutputFile,
  jobPromptExcerpt,
  jobPromptRows,
  jobRanLabel,
  jobRefGroups,
  jobSettingRows,
  jobShotDuration,
  jobStatusLabel,
  mergeJobOutputs,
  type JobAttachFile,
  type JobFilter,
} from "../lib/project-jobs";
import { runModes } from "../lib/mode-icons";
import { jobStatus } from "../../worker/job-record";
import { referenceRoleLabel } from "../../worker/schema";
import { FoldedPrompt } from "./CopyPrompt";
import { FullSizeMedia, type FitSlide } from "./FullSizeMedia";
import { GalleryAudioPop } from "./GalleryBrowser";
import { GalleryThumb } from "./GalleryThumb";
import { Loader } from "./Loader";
import { ModeIcons, ModelName } from "./ModeIcon";

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
  /** Add these files to the current prompt, the way the library attaches in an open project. */
  onAttach: (files: JobAttachFile[]) => void;
  onRefresh: () => void;
  /** Start a job from the brief with the project model. */
  onNewJob: () => void;
};

function outputPreview(output: ProjectJobOutput): string {
  return output.thumbUrl || output.resultUrl || "";
}

function outputKind(output: ProjectJobOutput): "image" | "video" | "audio" {
  return output.mediaType === "video" || output.mediaType === "audio" ? output.mediaType : "image";
}

function refId(ref: ProjectJobRef): string {
  return `${ref.kind}-${ref.number}-${ref.key}`;
}

function refFile(ref: ProjectJobRef): JobAttachFile {
  return { kind: ref.kind, name: ref.name, key: ref.key, url: ref.url, role: ref.role };
}

function refLabel(ref: ProjectJobRef): string {
  return mentionChipLabel(mentionToken(ref.kind, ref.number - 1));
}

export function ProjectJobs(props: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<JobFilter>({ model: "", status: "" });
  const [fitId, setFitId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ src: string; name: string } | null>(null);
  const openRow = useRef<HTMLLIElement>(null);
  const models = useMemo(() => [...new Set(props.jobs.map((job) => job.model))].sort(), [props.jobs]);
  const shown = filterJobs(props.jobs, filter);
  const modelLabel = (model: string) => props.modelNames.get(model) ?? jobModelLabel(model);
  const openJob = props.jobs.find((job) => job.batchId === openId) ?? null;

  useEffect(() => {
    if (openId) openRow.current?.scrollIntoView({ block: "nearest" });
  }, [openId]);

  function toggleJob(id: string | null) {
    setFitId(null);
    setPlaying(null);
    setOpenId(id);
  }

  // The open job's images and videos, in the order its references are listed.
  const slides: (FitSlide & { name: string })[] = useMemo(
    () =>
      openJob
        ? jobRefGroups(openJob.refs).flatMap((group) =>
            group.refs.flatMap((ref) =>
              ref.url && ref.kind !== "audio"
                ? [
                    {
                      id: refId(ref),
                      src: ref.url,
                      alt: `${refLabel(ref)}: ${ref.name}`,
                      name: ref.name,
                      mediaType: ref.kind,
                      poster: ref.thumbUrl,
                    },
                  ]
                : [],
            ),
          )
        : [],
    [openJob],
  );
  const fit = slides.find((slide) => slide.id === fitId) ?? null;

  function openRef(ref: ProjectJobRef) {
    if (!ref.url) return;
    if (ref.kind === "audio") {
      setPlaying({ src: ref.url, name: ref.name });
      return;
    }
    setFitId(refId(ref));
  }

  function renderRefs(job: ProjectJob) {
    return jobRefGroups(job.refs).map((group) => {
      const usable = group.refs.filter((ref) => ref.url);
      return (
        <section key={group.kind} className="job-ref-group" aria-label={`References: ${group.label}`}>
          <div className="job-ref-group-head">
            <span>{group.label}</span>
            <span className="job-ref-group-count">{group.refs.length}</span>
            <button
              type="button"
              className="ghost-btn job-small-btn"
              disabled={props.busy || usable.length === 0}
              title={`Attach every ${group.label.toLowerCase()} file of this job that is still in Studio`}
              onClick={() => props.onAttach(usable.map(refFile))}
            >
              Attach all
            </button>
          </div>
          <ul className="job-refs">
            {group.refs.map((ref) => {
              const label = refLabel(ref);
              const role = ref.kind === "audio" ? "Audio" : referenceRoleLabel(ref.role);
              return (
                <li key={refId(ref)} className={`job-ref${ref.url ? "" : " is-gone"}`}>
                  <button
                    type="button"
                    className="job-ref-media"
                    disabled={!ref.url}
                    aria-label={ref.url ? `Open ${label}, ${ref.name}` : `${label} is gone`}
                    title={ref.url ? (ref.kind === "audio" ? "Play" : "Open full size") : "This file is gone from Studio"}
                    onClick={() => openRef(ref)}
                  >
                    {ref.url ? (
                      <GalleryThumb kind={ref.kind} name={ref.name} preview={ref.thumbUrl || ref.url} slot="tile" />
                    ) : (
                      <span className="job-output-state">Gone</span>
                    )}
                  </button>
                  <span className="job-ref-number">{label}</span>
                  <span className="job-ref-role">{role}</span>
                  <span className="job-ref-name" title={ref.name}>
                    {ref.name}
                  </span>
                  {ref.url ? (
                    <button
                      type="button"
                      className="ghost-btn job-small-btn"
                      disabled={props.busy}
                      aria-label={`Attach ${label}`}
                      title="Add this file to the current prompt"
                      onClick={() => props.onAttach([refFile(ref)])}
                    >
                      Attach
                    </button>
                  ) : (
                    <span className="job-ref-gone">Gone</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      );
    });
  }

  function renderOutputs(job: ProjectJob, outputs: ProjectJobOutput[]) {
    return (
      <div className="job-outputs">
        {outputs.map((output, index) => {
          const preview = outputPreview(output);
          const finished = output.status === "succeeded" && Boolean(output.resultUrl);
          const failed = output.status === "failed" || output.status === "cancelled";
          const file = jobOutputFile(job, output);
          return (
            <div key={output.id} className={`job-output${failed ? " is-failed" : ""}`}>
              <button
                type="button"
                className="job-output-media"
                aria-label={finished ? `Open output ${index + 1} in the canvas` : `Output ${index + 1}`}
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
              {finished ? (
                <span className="job-output-actions">
                  <button
                    type="button"
                    className="ghost-btn job-small-btn"
                    disabled={props.busy || !file}
                    aria-label={`Attach output ${index + 1}`}
                    title="Use this result as a reference for the next job"
                    onClick={() => (file ? props.onAttach([file]) : undefined)}
                  >
                    Attach
                  </button>
                  <button
                    type="button"
                    className="ghost-btn job-small-btn"
                    onClick={() => props.onDownload(job, output)}
                  >
                    Download
                  </button>
                </span>
              ) : null}
              {failed && output.errorMessage ? (
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
        <button
          type="button"
          className="primary-btn project-new-job"
          disabled={props.busy}
          title="Start a job from the brief: its prompt, looks, references, and the project model"
          onClick={props.onNewJob}
        >
          New job
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
          const ran = jobRanLabel(job.createdAt);
          const exact = jobExactTime(job.createdAt);
          const error = jobErrorText(outputs);
          const duration = jobDurationLabel(outputs);
          return (
            <li
              key={job.batchId}
              ref={expanded ? openRow : undefined}
              className={`job-row${expanded ? " is-open" : ""}`}
            >
              <button
                type="button"
                className="job-summary"
                aria-expanded={expanded}
                onClick={() => toggleJob(expanded ? null : job.batchId)}
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
                    <ModeIcons modes={runModes(job.mode)} className="job-meta-kind" />
                    <time className="job-ran" dateTime={new Date(job.createdAt * 1000).toISOString()} title={exact}>
                      {ran}
                    </time>
                    {` · ${modelLabel(job.model)} · ${jobModeLabel(job.mode)}`}
                    {job.cost != null ? ` · ${jobCostLabel(job.cost)}` : ""}
                  </span>
                  {error && (status === "failed" || status === "partial" || status === "cancelled") ? (
                    <span className="job-row-error" title={error}>
                      {error}
                    </span>
                  ) : null}
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
                          ? "Finished outputs can join the references"
                          : `Add ${castFiles.length} ${castFiles.length === 1 ? "output" : "outputs"} to the references, taking the next numbers`
                      }
                      onClick={() => props.onAddOutputs(job, outputs)}
                    >
                      Add outputs to references
                    </button>
                  </div>
                  <dl className="job-facts" aria-label="About this job">
                    <div>
                      <dt>Ran</dt>
                      <dd title={exact}>{ran}</dd>
                    </div>
                    <div>
                      <dt>Took</dt>
                      <dd>{duration ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{jobStatusLabel(status)}</dd>
                    </div>
                    <div>
                      <dt>Model</dt>
                      <dd>
                        <ModelName name={modelLabel(job.model)} modes={runModes(job.mode)} />
                      </dd>
                    </div>
                    <div>
                      <dt>Mode</dt>
                      <dd>{jobModeLabel(job.mode)}</dd>
                    </div>
                    <div>
                      <dt>Cost</dt>
                      <dd>{job.cost != null ? jobCostLabel(job.cost) : "—"}</dd>
                    </div>
                    <div>
                      <dt>Outputs</dt>
                      <dd>{outputs.length}</dd>
                    </div>
                  </dl>
                  <div className="job-prompts">
                    {jobPromptRows(job).map((row) => (
                      <FoldedPrompt key={row.label} label={row.label} prompt={row.text} />
                    ))}
                  </div>
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
                  {job.multiPrompt && job.multiPrompt.length > 0 ? (
                    <>
                      <h4 className="job-heading">Shots</h4>
                      <ol className="job-shots">
                        {job.multiPrompt.map((shot, index) => {
                          const length = jobShotDuration(shot.duration);
                          return (
                            <li key={index}>
                              <span className="job-shot-head">
                                Shot {index + 1}
                                {length ? ` · ${length}` : ""}
                              </span>
                              <span className="job-shot-prompt">{shot.prompt}</span>
                            </li>
                          );
                        })}
                      </ol>
                    </>
                  ) : null}
                  {job.refs.length > 0 ? (
                    <>
                      <h4 className="job-heading">References</h4>
                      {renderRefs(job)}
                    </>
                  ) : null}
                  {settingRows.length > 0 ? (
                    <>
                      <h4 className="job-heading">Settings</h4>
                      <dl className="job-settings">
                        {settingRows.map((row) => (
                          <div key={row.label}>
                            <dt>{row.label}</dt>
                            <dd>{row.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </>
                  ) : null}
                  <h4 className="job-heading">Outputs</h4>
                  {renderOutputs(job, outputs)}
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
      {fit ? (
        <FullSizeMedia
          src={fit.src}
          alt={fit.alt}
          slides={slides}
          mediaType={fit.mediaType}
          autoPlay={fit.mediaType === "video"}
          activeId={fit.id}
          onSlide={setFitId}
          onClose={() => setFitId(null)}
        />
      ) : null}
      {playing ? <GalleryAudioPop src={playing.src} name={playing.name} onClose={() => setPlaying(null)} /> : null}
    </section>
  );
}
