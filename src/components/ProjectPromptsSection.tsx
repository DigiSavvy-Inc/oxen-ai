import { useState, type DragEvent } from "react";
import type { ProjectPrompt } from "../lib/api";
import {
  filterProjectPrompts,
  PROJECT_PROMPT_MAX,
  PROJECT_PROMPT_NAME_MAX,
  PROJECT_PROMPTS_MAX,
  promptFirstLine,
  sortProjectPrompts,
} from "../../worker/project-prompts";
import { copyPromptText } from "../lib/clipboard";

export type ProjectPromptDraft = { name: string; body: string; everyScene: boolean };

type Props = {
  prompts: ProjectPrompt[];
  busy: boolean;
  /** Resolves true when the prompt was saved, so the form can close. */
  onCreate: (draft: ProjectPromptDraft) => Promise<boolean>;
  onUpdate: (id: string, patch: Partial<ProjectPromptDraft>) => Promise<boolean>;
  onDelete: (id: string) => void;
  /** Every prompt id in the new list order. */
  onReorder: (ids: string[]) => void;
};

/** A filter box shows once the list is longer than this. */
const FILTER_AFTER = 8;

/** The list with one id moved to sit just before another (or to the end). */
function movedOrder(ids: readonly string[], moving: string, before: string | null): string[] {
  const rest = ids.filter((id) => id !== moving);
  const at = before ? rest.indexOf(before) : -1;
  if (at < 0) return [...rest, moving];
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/**
 * The Brief's Prompts section: the project's named prompts in two groups. Every scene prompts
 * are on for each new job; On request prompts wait in the composer's Prompts menu.
 */
export function ProjectPromptsSection(props: Props) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<ProjectPromptDraft | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; body: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const ordered = sortProjectPrompts(props.prompts);
  const shown = props.prompts.length > FILTER_AFTER ? filterProjectPrompts(props.prompts, query) : ordered;
  const full = props.prompts.length >= PROJECT_PROMPTS_MAX;
  const groups = [
    { label: "Every scene", every: true, prompts: shown.filter((prompt) => prompt.everyScene) },
    { label: "On request", every: false, prompts: shown.filter((prompt) => !prompt.everyScene) },
  ];

  async function commitAdd() {
    if (!adding || saving) return;
    setSaving(true);
    try {
      if (await props.onCreate({ ...adding, name: adding.name.trim() })) setAdding(null);
    } finally {
      setSaving(false);
    }
  }

  async function commitEdit() {
    if (!editing || saving) return;
    setSaving(true);
    try {
      if (await props.onUpdate(editing.id, { name: editing.name.trim(), body: editing.body })) setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  function dropOn(event: DragEvent, before: string | null) {
    event.preventDefault();
    const moving = dragId ?? event.dataTransfer.getData("text/x-project-prompt");
    setDragId(null);
    setOverId(null);
    if (!moving || moving === before) return;
    const ids = ordered.map((prompt) => prompt.id);
    const next = movedOrder(ids, moving, before);
    if (next.join("\n") !== ids.join("\n")) props.onReorder(next);
  }

  function editorFields(
    value: { name: string; body: string },
    change: (patch: { name?: string; body?: string }) => void,
  ) {
    return (
      <>
        <input
          className="field"
          value={value.name}
          placeholder="Name"
          aria-label="Prompt name"
          maxLength={PROJECT_PROMPT_NAME_MAX}
          autoFocus
          onChange={(event) => change({ name: event.target.value })}
        />
        <textarea
          className="field"
          value={value.body}
          placeholder="Text that goes after the looks and ahead of the scene. Mentions like @Image1 or @Maya work here."
          aria-label="Prompt text"
          rows={3}
          maxLength={PROJECT_PROMPT_MAX}
          onCopy={copyPromptText}
          onChange={(event) => change({ body: event.target.value })}
        />
      </>
    );
  }

  return (
    <div className="project-editor-look project-prompts">
      <div className="project-editor-head">
        <h3>Prompts</h3>
        <span className="project-rail-empty">
          {props.prompts.length} of {PROJECT_PROMPTS_MAX}
        </span>
      </div>
      {props.prompts.length > FILTER_AFTER ? (
        <input
          className="field"
          type="search"
          value={query}
          placeholder="Filter prompts"
          aria-label="Filter project prompts"
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      {props.prompts.length === 0 ? (
        <p className="project-rail-empty">
          No prompts yet. Every scene prompts are on for each new job; On request prompts wait in the
          composer’s Prompts menu. Both go after the looks and ahead of the scene.
        </p>
      ) : null}
      {props.prompts.length > 0 && shown.length === 0 ? (
        <p className="project-rail-empty">No prompt matches “{query.trim()}”.</p>
      ) : null}
      {props.prompts.length > 0
        ? groups.map((group) => (
            <div key={group.label} className="project-prompt-group" role="group" aria-label={group.label}>
              <div className="look-section-label">{group.label}</div>
              {group.prompts.length === 0 ? (
                <p className="project-rail-empty">
                  {group.every ? "None on for every scene." : "None waiting on request."}
                </p>
              ) : (
                <ul className="project-prompt-list">
                  {group.prompts.map((item) =>
                    editing?.id === item.id ? (
                      <li key={item.id} className="project-prompt-row is-editing">
                        <form
                          className="saved-prompt-editor"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void commitEdit();
                          }}
                        >
                          {editorFields(editing, (patch) =>
                            setEditing((current) => (current ? { ...current, ...patch } : current)),
                          )}
                          <div className="look-editor-row">
                            <span className="look-count">
                              {editing.body.length}/{PROJECT_PROMPT_MAX}
                            </span>
                            <button type="button" className="prompt-action" onClick={() => setEditing(null)}>
                              Cancel
                            </button>
                            <button
                              type="submit"
                              className="prompt-action"
                              disabled={saving || props.busy || !editing.name.trim() || !editing.body.trim()}
                            >
                              {saving ? "Saving…" : "Save"}
                            </button>
                          </div>
                        </form>
                      </li>
                    ) : (
                      <li
                        key={item.id}
                        className={`project-prompt-row${overId === item.id ? " is-drop" : ""}${dragId === item.id ? " is-dragging" : ""}`}
                        draggable={!query.trim()}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/x-project-prompt", item.id);
                          setDragId(item.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverId(null);
                        }}
                        onDragOver={(event) => {
                          if (!dragId) return;
                          event.preventDefault();
                          if (overId !== item.id) setOverId(item.id);
                        }}
                        onDrop={(event) => dropOn(event, item.id)}
                      >
                        <span className="project-prompt-grip" aria-hidden title="Drag to reorder">
                          ⋮⋮
                        </span>
                        <span className="project-prompt-text" title={item.body}>
                          <span className="look-pick-name">{item.name}</span>
                          <span className="look-pick-body">{promptFirstLine(item.body)}</span>
                        </span>
                        <label
                          className="project-prompt-switch"
                          title="Every scene prompts are on for each new job. Off means On request."
                        >
                          <input
                            type="checkbox"
                            role="switch"
                            checked={item.everyScene}
                            disabled={props.busy}
                            aria-label={`${item.name}: every scene`}
                            onChange={(event) => void props.onUpdate(item.id, { everyScene: event.target.checked })}
                          />
                          Every scene
                        </label>
                        <button
                          type="button"
                          className="saved-prompt-edit"
                          aria-label={`Edit ${item.name}`}
                          onClick={() => setEditing({ id: item.id, name: item.name, body: item.body })}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="saved-prompt-delete"
                          aria-label={`Delete ${item.name}`}
                          onClick={() => {
                            if (window.confirm(`Delete the project prompt “${item.name}”?`)) props.onDelete(item.id);
                          }}
                        >
                          ×
                        </button>
                      </li>
                    ),
                  )}
                </ul>
              )}
            </div>
          ))
        : null}
      {dragId ? (
        <div
          className={`project-prompt-tail${overId === "" ? " is-drop" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (overId !== "") setOverId("");
          }}
          onDrop={(event) => dropOn(event, null)}
        >
          Drop here to move it to the end
        </div>
      ) : null}
      {adding ? (
        <form
          className="saved-prompt-editor project-prompt-add"
          onSubmit={(event) => {
            event.preventDefault();
            void commitAdd();
          }}
        >
          {editorFields(adding, (patch) => setAdding((current) => (current ? { ...current, ...patch } : current)))}
          <div className="look-editor-row">
            <label className="project-prompt-switch">
              <input
                type="checkbox"
                role="switch"
                checked={adding.everyScene}
                onChange={(event) =>
                  setAdding((current) => (current ? { ...current, everyScene: event.target.checked } : current))
                }
              />
              Every scene
            </label>
            <span className="look-count">
              {adding.body.length}/{PROJECT_PROMPT_MAX}
            </span>
            <button type="button" className="prompt-action" onClick={() => setAdding(null)}>
              Cancel
            </button>
            <button
              type="submit"
              className="prompt-action"
              disabled={saving || props.busy || !adding.name.trim() || !adding.body.trim()}
            >
              {saving ? "Saving…" : "Add"}
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="ghost-btn"
          disabled={props.busy || full}
          title={full ? `${PROJECT_PROMPTS_MAX} prompts is the limit` : undefined}
          onClick={() => setAdding({ name: "", body: "", everyScene: true })}
        >
          Add prompt
        </button>
      )}
    </div>
  );
}
