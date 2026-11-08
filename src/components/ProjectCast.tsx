import { useState } from "react";
import type { GallerySummary } from "../lib/api";
import { mentionChipLabel, mentionToken } from "../lib/api";
import {
  castSummaryLabel,
  type CastEntry,
  type CastItem,
  type CastSelection,
} from "../lib/cast";
import { filesFromList } from "../lib/files";
import type { MediaRole } from "../../worker/schema";
import { GalleryRoleSelect } from "./GalleryRoleSelect";
import { GalleryThumb } from "./GalleryThumb";

type Props = {
  entries: CastEntry[];
  items: CastItem[];
  selection: CastSelection;
  budget: number;
  modelCaps: Record<"image" | "video" | "audio", number> | null;
  galleries: GallerySummary[];
  busy: boolean;
  notice: string | null;
  dropAccept: string;
  onBudgetChange: (budget: number) => void;
  onToggleEntry: (entryId: string, active: boolean) => void;
  onRemoveEntry: (entryId: string) => void;
  onMoveEntry: (from: number, to: number) => void;
  onToggleItem: (item: CastItem, active: boolean) => void;
  onRemoveItem: (item: CastItem) => void;
  onRoleChange: (item: CastItem, role: MediaRole) => void;
  onAddGallery: (galleryId: string) => void;
  onAddFiles: (files: File[]) => void;
  onOpenLibrary: () => void;
  onOpenGallery: (galleryId: string) => void;
};

function entryItems(items: CastItem[], entryId: string): CastItem[] {
  return items.filter((item) => item.entryId === entryId);
}

export function ProjectCast(props: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [picking, setPicking] = useState(false);
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const attachedIds = new Set(props.selection.attached.map((item) => item.id));
  const skippedIds = new Set(props.selection.skipped.map((item) => item.id));
  const unassigned = props.galleries.filter(
    (gallery) => !props.entries.some((entry) => entry.type === "gallery" && entry.id === gallery.id),
  );
  const capLine = props.modelCaps
    ? (["image", "video", "audio"] as const)
        .filter((kind) => props.modelCaps![kind] > 0)
        .map((kind) => `${props.modelCaps![kind]} ${kind}`)
        .join(", ")
    : "";

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function commitBudget() {
    if (budgetDraft == null) return;
    const value = Math.round(Number(budgetDraft));
    setBudgetDraft(null);
    if (!Number.isFinite(value) || value < 1 || value > 96 || value === props.budget) return;
    props.onBudgetChange(value);
  }

  function renderTile(item: CastItem) {
    const token = mentionToken(item.kind, item.number - 1);
    const attached = attachedIds.has(item.id);
    const skipped = item.active && skippedIds.has(item.id);
    const state = !item.active ? "Off" : attached ? "Attached" : skipped ? "Model can’t take it" : "Over budget";
    return (
      <div
        key={item.id}
        className={`cast-tile${item.active ? "" : " is-off"}${attached ? " is-attached" : ""}`}
        title={`${token} · ${item.name} · ${state}`}
      >
        <div className="cast-tile-media">
          <GalleryThumb kind={item.kind} name={item.name} preview={item.preview} slot="tile" />
        </div>
        <span className="cast-tile-number">{mentionChipLabel(token)}</span>
        <label className="cast-tile-toggle" title={item.active ? "Active. Click to turn off." : "Off. Click to turn on."}>
          <input
            type="checkbox"
            checked={item.active}
            aria-label={`${item.active ? "Turn off" : "Turn on"} ${token}`}
            disabled={props.busy}
            onChange={(event) => props.onToggleItem(item, event.target.checked)}
          />
        </label>
        <button
          type="button"
          className="gallery-remove cast-tile-remove"
          aria-label={`Remove ${token} from the cast`}
          title="Remove from the cast. Later numbers move up."
          disabled={props.busy}
          onClick={() => props.onRemoveItem(item)}
        >
          ×
        </button>
        <div className="cast-tile-foot">
          {item.kind !== "audio" ? (
            <GalleryRoleSelect
              compact
              name={token}
              role={item.role}
              onChange={(role) => props.onRoleChange(item, role)}
            />
          ) : (
            <span className="cast-tile-kind">Audio</span>
          )}
          <span className={`cast-tile-state${attached ? " is-on" : ""}`}>{state}</span>
        </div>
      </div>
    );
  }

  return (
    <section className="cast-panel" aria-label="Cast">
      <div className="cast-summary">
        <strong>{castSummaryLabel(props.selection)}</strong>
        <label className="cast-budget">
          Budget
          <input
            className="field"
            type="number"
            min={1}
            max={96}
            inputMode="numeric"
            aria-label="Reference budget"
            value={budgetDraft ?? String(props.budget)}
            disabled={props.busy}
            onChange={(event) => setBudgetDraft(event.target.value)}
            onBlur={commitBudget}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            }}
          />
        </label>
      </div>
      <p className="cast-caps">
        {props.modelCaps
          ? capLine
            ? `The model takes up to ${capLine}.`
            : "Pick a model that takes references to attach the cast."
          : "Pick a model to see its reference limit."}
        {props.selection.overBudget > 0 ? ` ${props.selection.overBudget} over budget.` : ""}
        {props.selection.skipped.length > 0 ? ` ${props.selection.skipped.length} skipped for this model.` : ""}
      </p>
      {props.notice ? <p className="cast-notice" role="status">{props.notice}</p> : null}
      {props.entries.length === 0 ? (
        <p className="project-rail-empty">
          Nothing in the cast yet. Add a gallery or drop files; the project numbers them in the order they arrive.
        </p>
      ) : null}
      <div className="cast-groups">
        {props.entries.map((entry, index) => {
          const members = entryItems(props.items, entry.id);
          const isGallery = entry.type === "gallery";
          const open = !collapsed.has(entry.id);
          const label = isGallery ? entry.name : entry.name;
          return (
            <div key={entry.id} className={`cast-group${entry.active ? "" : " is-off"}`}>
              <div className="cast-group-head">
                {isGallery ? (
                  <button
                    type="button"
                    className="project-rail-expand"
                    aria-expanded={open}
                    aria-label={`${open ? "Collapse" : "Expand"} ${label}`}
                    onClick={() => toggleCollapsed(entry.id)}
                  >
                    {open ? "▾" : "▸"}
                  </button>
                ) : (
                  <span className="cast-group-dot" aria-hidden>
                    ·
                  </span>
                )}
                <span className="cast-group-title">
                  {isGallery ? (
                    <button
                      type="button"
                      className="cast-group-link"
                      title="Open this gallery in the Library"
                      onClick={() => props.onOpenGallery(entry.id)}
                    >
                      {label}
                    </button>
                  ) : (
                    label
                  )}
                  <span className="cast-group-count">
                    {isGallery
                      ? ` · ${members.length}`
                      : ` · ${mentionChipLabel(mentionToken(entry.kind, (members[0]?.number ?? 1) - 1))}`}
                  </span>
                </span>
                <div className="cast-group-actions">
                  <button
                    type="button"
                    className="ghost-btn cast-move"
                    aria-label={`Move ${label} up`}
                    title="Move up. Mentions in the brief follow."
                    disabled={props.busy || index === 0}
                    onClick={() => props.onMoveEntry(index, index - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ghost-btn cast-move"
                    aria-label={`Move ${label} down`}
                    title="Move down. Mentions in the brief follow."
                    disabled={props.busy || index === props.entries.length - 1}
                    onClick={() => props.onMoveEntry(index, index + 1)}
                  >
                    ↓
                  </button>
                  <label className="cast-switch" title={entry.active ? "Active. Click to turn off." : "Off. Click to turn on."}>
                    <input
                      type="checkbox"
                      role="switch"
                      checked={entry.active}
                      aria-label={`${entry.active ? "Turn off" : "Turn on"} ${label}`}
                      disabled={props.busy}
                      onChange={(event) => props.onToggleEntry(entry.id, event.target.checked)}
                    />
                    <span />
                  </label>
                  <button
                    type="button"
                    className="gallery-close"
                    aria-label={`Remove ${label} from the project`}
                    title="Remove from the project. Later numbers move up."
                    disabled={props.busy}
                    onClick={() => props.onRemoveEntry(entry.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
              {open ? (
                members.length === 0 ? (
                  <p className="project-rail-empty">This gallery is empty.</p>
                ) : (
                  <div className="cast-grid">{members.map(renderTile)}</div>
                )
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="cast-add">
        <button
          type="button"
          className="ghost-btn"
          disabled={props.busy || unassigned.length === 0}
          onClick={() => setPicking((value) => !value)}
        >
          Add gallery
        </button>
        <label className="ghost-btn">
          Drop files
          <input
            type="file"
            accept={props.dropAccept || undefined}
            multiple
            disabled={props.busy}
            onChange={(event) => {
              props.onAddFiles(filesFromList(event.target.files));
              event.target.value = "";
            }}
          />
        </label>
        <button type="button" className="ghost-btn" disabled={props.busy} onClick={props.onOpenLibrary}>
          From Library
        </button>
      </div>
      {picking && unassigned.length > 0 ? (
        <ul className="cast-gallery-pick">
          {unassigned.map((gallery) => (
            <li key={gallery.id}>
              <button
                type="button"
                className="project-session"
                onClick={() => {
                  props.onAddGallery(gallery.id);
                  setPicking(false);
                }}
              >
                {gallery.name}
                {gallery.count != null ? <span className="cast-group-count"> · {gallery.count}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
