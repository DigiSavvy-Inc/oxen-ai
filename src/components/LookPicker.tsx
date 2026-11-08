import { useEffect, useRef, useState } from "react";
import type { LookGroup, StudioLook } from "../lib/api";
import { LOOK_BODY_MAX, LOOK_GROUPS, lookSections, PROJECT_LOOKS_MAX } from "../../worker/looks";

export type LookDraft = { name: string; body: string; group: LookGroup | null };

type Props = {
  looks: StudioLook[];
  appliedIds: string[];
  /** Prefilled from selected prompt text by "Save as look". */
  initialDraft: LookDraft | null;
  busy: boolean;
  onToggle: (id: string) => void;
  onCreate: (draft: LookDraft) => Promise<StudioLook | null>;
  onStar: (id: string, starred: boolean) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1.1 5.9L12 16.9l-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8z"
        fill="currentColor"
      />
    </svg>
  );
}

export function LookPicker(props: Props) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<LookDraft | null>(props.initialDraft);
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(props.onClose);
  const full = props.appliedIds.length >= PROJECT_LOOKS_MAX;
  const sections = lookSections(props.looks, query);

  useEffect(() => {
    closeRef.current = props.onClose;
  }, [props.onClose]);

  useEffect(() => {
    if (draft) nameRef.current?.focus();
    else searchRef.current?.focus();
  }, [draft]);

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
      // The Look button that opened this menu toggles it closed itself.
      if (target instanceof Element && target.closest("[data-look-trigger]")) return;
      closeRef.current();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  async function commitDraft() {
    if (!draft || saving) return;
    const name = draft.name.trim();
    const body = draft.body.trim();
    if (!name || !body || body.length > LOOK_BODY_MAX) return;
    setSaving(true);
    try {
      const created = await props.onCreate({ name, body, group: draft.group });
      if (created) {
        setDraft(null);
        if (!props.appliedIds.includes(created.id) && !full) props.onToggle(created.id);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="saved-prompts-menu look-menu" role="dialog" aria-label="Looks" ref={rootRef}>
      {draft ? (
        <form
          className="saved-prompt-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void commitDraft();
          }}
        >
          <input
            ref={nameRef}
            className="field"
            value={draft.name}
            placeholder="Look name"
            aria-label="Look name"
            maxLength={80}
            onChange={(event) => setDraft((d) => (d ? { ...d, name: event.target.value } : d))}
          />
          <textarea
            className="field"
            value={draft.body}
            aria-label="Look text"
            placeholder="Shot on 35mm, soft window light, muted color."
            rows={3}
            maxLength={LOOK_BODY_MAX}
            onChange={(event) => setDraft((d) => (d ? { ...d, body: event.target.value } : d))}
          />
          <div className="look-editor-row">
            <select
              className="field"
              aria-label="Look group"
              value={draft.group ?? ""}
              onChange={(event) =>
                setDraft((d) => (d ? { ...d, group: (event.target.value || null) as LookGroup | null } : d))
              }
            >
              <option value="">No group</option>
              {LOOK_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {group}
                </option>
              ))}
            </select>
            <span className="look-count" aria-live="polite">
              {draft.body.length}/{LOOK_BODY_MAX}
            </span>
            <button type="button" className="prompt-action" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              type="submit"
              className="prompt-action"
              disabled={saving || props.busy || !draft.name.trim() || !draft.body.trim()}
            >
              {saving ? "Saving…" : "Save look"}
            </button>
          </div>
        </form>
      ) : (
        <div className="look-menu-head">
          <input
            ref={searchRef}
            className="field"
            type="search"
            value={query}
            placeholder="Search looks"
            aria-label="Search looks"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className="prompt-action"
            onClick={() => setDraft({ name: "", body: "", group: null })}
          >
            New look
          </button>
        </div>
      )}
      {full ? (
        <p className="saved-prompts-empty">
          {PROJECT_LOOKS_MAX} looks is the limit. Remove a chip to apply another.
        </p>
      ) : null}
      {props.looks.length === 0 && !draft ? (
        <p className="saved-prompts-empty">
          No looks yet. Select prompt text and choose Save as look, or add one here.
        </p>
      ) : null}
      {props.looks.length > 0 && sections.length === 0 ? (
        <p className="saved-prompts-empty">No look matches “{query.trim()}”.</p>
      ) : null}
      {sections.map((section) => (
        <div key={section.label} className="look-section" role="group" aria-label={section.label}>
          <div className="look-section-label">{section.label}</div>
          {section.looks.map((look) => {
            const applied = props.appliedIds.includes(look.id);
            return (
              <div key={look.id} className={`saved-prompt-row look-row${applied ? " is-applied" : ""}`}>
                <button
                  type="button"
                  className={`look-star${look.starred ? " is-on" : ""}`}
                  aria-pressed={look.starred}
                  aria-label={look.starred ? `Unstar ${look.name}` : `Star ${look.name}`}
                  title={look.starred ? "Starred. Starred looks list first." : "Star this look"}
                  onClick={() => props.onStar(look.id, !look.starred)}
                >
                  <StarIcon />
                </button>
                <button
                  type="button"
                  className="saved-prompt-load look-pick"
                  aria-pressed={applied}
                  disabled={!applied && full}
                  title={look.body}
                  onClick={() => props.onToggle(look.id)}
                >
                  <span className="look-pick-name">{look.name}</span>
                  <span className="look-pick-body">{look.body}</span>
                </button>
                {applied ? (
                  <span className="look-applied-mark" aria-hidden>
                    ✓
                  </span>
                ) : null}
                <button
                  type="button"
                  className="saved-prompt-delete"
                  aria-label={`Delete look ${look.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete the look “${look.name}”?`)) props.onDelete(look.id);
                  }}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
