import { useEffect, useRef, useState } from "react";
import type { ProjectPrompt } from "../lib/api";
import { everySceneCounts, filterProjectPrompts, promptFirstLine } from "../../worker/project-prompts";

type Props = {
  prompts: ProjectPrompt[];
  /** Prompts on for this job. */
  onIds: string[];
  onToggle: (id: string) => void;
  /** Put every Every scene prompt back on for this job. */
  onRestore: () => void;
  onClose: () => void;
};

/**
 * The composer's Prompts picker: every project prompt with its state for this job. Typing
 * filters; a click or Enter switches one on or off. The project itself is not changed.
 */
export function ProjectPromptPicker(props: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(props.onClose);
  const shown = filterProjectPrompts(props.prompts, query);
  const groups = [
    { label: "Every scene", prompts: shown.filter((prompt) => prompt.everyScene) },
    { label: "On request", prompts: shown.filter((prompt) => !prompt.everyScene) },
  ].filter((group) => group.prompts.length > 0);
  const ordered = groups.flatMap((group) => group.prompts);
  const counts = everySceneCounts(props.onIds, props.prompts);
  const hot = Math.min(active, Math.max(0, ordered.length - 1));

  useEffect(() => {
    closeRef.current = props.onClose;
  }, [props.onClose]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
      }
    }
    function onPointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      // The Prompts button that opened this menu toggles it closed itself.
      if (target instanceof Element && target.closest("[data-project-prompt-trigger]")) return;
      closeRef.current();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  return (
    <div
      className="saved-prompts-menu look-menu project-prompt-menu"
      role="dialog"
      aria-label="Project prompts"
      ref={rootRef}
    >
      <div className="look-menu-head">
        <input
          ref={searchRef}
          className="field"
          type="search"
          value={query}
          placeholder="Filter prompts"
          aria-label="Filter project prompts"
          aria-controls="project-prompt-list"
          aria-activedescendant={ordered[hot] ? `project-prompt-${ordered[hot].id}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, Math.max(0, ordered.length - 1)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(0, index - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              const target = ordered[hot];
              if (target) props.onToggle(target.id);
            }
          }}
        />
        {counts.on < counts.total ? (
          <button type="button" className="prompt-action" onClick={props.onRestore}>
            Put back Every scene
          </button>
        ) : null}
        <button type="button" className="prompt-action project-prompt-close" onClick={props.onClose}>
          Done
        </button>
      </div>
      {props.prompts.length === 0 ? (
        <p className="saved-prompts-empty">
          This project has no prompts yet. Add them in the project’s Brief, or select prompt text and
          choose Save as project prompt.
        </p>
      ) : null}
      {props.prompts.length > 0 && ordered.length === 0 ? (
        <p className="saved-prompts-empty">No prompt matches “{query.trim()}”.</p>
      ) : null}
      <div id="project-prompt-list" role="listbox" aria-multiselectable="true" aria-label="Project prompts">
        {groups.map((group) => (
          <div key={group.label} className="look-section" role="group" aria-label={group.label}>
            <div className="look-section-label">{group.label}</div>
            {group.prompts.map((prompt) => {
              const on = props.onIds.includes(prompt.id);
              const index = ordered.indexOf(prompt);
              return (
                <div
                  key={prompt.id}
                  className={`saved-prompt-row look-row${on ? " is-applied" : ""}${index === hot ? " is-hot" : ""}`}
                >
                  <button
                    type="button"
                    id={`project-prompt-${prompt.id}`}
                    role="option"
                    aria-selected={on}
                    className="saved-prompt-load look-pick"
                    aria-pressed={on}
                    title={prompt.body}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => props.onToggle(prompt.id)}
                  >
                    <span className="look-pick-name">{prompt.name}</span>
                    <span className="look-pick-body">{promptFirstLine(prompt.body)}</span>
                  </button>
                  <span className={`project-prompt-state${on ? " is-on" : ""}`}>{on ? "On" : "Off"}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
