import { useEffect, useState } from "react";
import { MODE_LABELS, type GenerationMode, type ReferenceModel, type StudioLook, type StudioProject } from "../lib/api";
import {
  ORIGIN_LABELS,
  referenceCapsLabel,
  referenceModeFor,
  sortReferenceModels,
  type ComposerOrigin,
} from "../lib/project-model";
import { appliedLooks, PROJECT_LOOKS_MAX, sortLooks } from "../../worker/looks";
import { copyPromptText } from "../lib/clipboard";
import { ModelMenu } from "./ModelMenu";

type Props = {
  project: StudioProject;
  looks: StudioLook[];
  /** Reference-capable models from the live catalog; null while loading. */
  referenceModels: ReferenceModel[] | null;
  referenceModelsError: string | null;
  /** Ids the user starred in Oxen; they list first. */
  preferredModelIds: ReadonlySet<string>;
  onPinModel: (model: ReferenceModel | null) => void;
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
  /** True when the composer differs from the saved brief (a draft is being kept). */
  hasDraft: boolean;
  /** Where the composer's contents came from this visit. */
  origin: ComposerOrigin;
  onNewJob: () => void;
};

function modeLabel(mode: string | null): string {
  return mode && mode in MODE_LABELS ? MODE_LABELS[mode as GenerationMode] : "";
}

export function ProjectBrief(props: Props) {
  const [name, setName] = useState(props.project.name);
  const [days, setDays] = useState("7");
  const chosenLooks = appliedLooks(props.lookIds, props.looks);
  const lookOptions = sortLooks(props.looks).filter((look) => !props.lookIds.includes(look.id));
  const defaults = props.project.defaults;
  const pinnedId = defaults?.pinned ? defaults.model : "";
  const modelOptions = props.referenceModels ? sortReferenceModels(props.referenceModels, props.preferredModelIds) : [];
  const pinnedModel = modelOptions.find((model) => model.id === pinnedId) ?? null;
  const preferredModels = modelOptions.filter((model) => props.preferredModelIds.has(model.id));
  const capsById = new Map(modelOptions.map((model) => [model.id, referenceCapsLabel(model.caps)] as const));
  const lastRunLabel =
    !pinnedId && defaults?.model
      ? `${props.referenceModels?.find((model) => model.id === defaults.model)?.display_name ?? defaults.model}${
          modeLabel(defaults.mode) ? ` · ${modeLabel(defaults.mode)}` : ""
        }`
      : null;

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
          onCopy={copyPromptText}
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
      <div className="project-editor-look project-brief-model">
        <div className="project-editor-head">
          <h3>Model</h3>
          {pinnedModel ? (
            <span className="project-rail-empty">{referenceCapsLabel(pinnedModel.caps)}</span>
          ) : null}
        </div>
        <ModelMenu
          block
          label="Project model"
          emptyOption={
            props.referenceModels == null
              ? "Loading models…"
              : lastRunLabel
                ? `Last run’s model (${lastRunLabel})`
                : "Whatever the composer has"
          }
          models={modelOptions}
          preferred={preferredModels}
          value={pinnedModel ? pinnedModel.id : ""}
          detail={(model) => capsById.get(model.id) ?? null}
          disabled={props.busy || props.referenceModels == null}
          onChange={(id) => props.onPinModel(id ? (modelOptions.find((model) => model.id === id) ?? null) : null)}
        />
        <p className="project-rail-empty">
          {props.referenceModelsError
            ? props.referenceModelsError
            : pinnedModel
              ? `${modeLabel(referenceModeFor(pinnedModel)) || "Reference mode"}. New job and opening the project use this model; a run can still pick another in the composer without changing it here.`
              : "Models that take image, video, or audio references. Without a pick, the last run’s model and settings come back."}
        </p>
      </div>
      <div className="project-editor-share project-brief-draft">
        <div className="project-editor-head">
          <h3>Composer</h3>
          <button
            type="button"
            className="primary-btn project-new-job"
            disabled={props.busy}
            title="Start a job from the brief: its prompt, looks, references, and the project model, count 1×"
            onClick={props.onNewJob}
          >
            New job
          </button>
        </div>
        <p>
          <span className={`project-origin is-${props.origin}`}>{ORIGIN_LABELS[props.origin]}</span>{" "}
          {props.origin === "draft"
            ? "The composer came back as you left it. New job clears the scene text and starts from this brief."
            : props.hasDraft
              ? "This job started from the brief and has edits, kept as the project’s draft for next time."
              : "This job started from the brief. Edits in the composer are kept as the project’s draft."}
        </p>
      </div>
      <div className="project-editor-share">
        <h3>Share link</h3>
        <p>Someone signed in can generate with this brief and references. They cannot change this project.</p>
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
