import { useState, type DragEvent } from "react";
import type { GallerySummary, ProjectSummary, SlotFile, SlotFileInput, StudioSlot } from "../lib/api";
import { filesFromList } from "../lib/files";
import { fileDragOffered, historyDragOffered, readHistoryDrag } from "../lib/history-drag";
import { moveItem } from "../lib/mentions";
import { useTileReorder } from "../lib/tile-reorder";
import { normalizeMediaRole } from "../../worker/schema";
import { GalleryMentionFields } from "./GalleryMentionFields";
import { GalleryRoleSelect } from "./GalleryRoleSelect";
import { GalleryThumb } from "./GalleryThumb";
import { Loader } from "./Loader";
import { PanelPlaceSwitch } from "./PanelPlace";
import { SlotGalleryPicker } from "./SlotGalleryPicker";
import { openAfterChange, slotRowMeta, slotSource } from "../lib/slot-pick";

type AttachedFile = {
  kind: "image" | "video" | "audio";
  name: string;
  key: string;
  role?: string | null;
};

type Props = {
  open: boolean;
  slots: StudioSlot[];
  projects: ProjectSummary[];
  activeProjectId: string | null;
  galleries: GallerySummary[];
  attached: AttachedFile[];
  loading: boolean;
  notice: string | null;
  onClose: () => void;
  onCreate: (projectId: string | null, name: string) => void;
  onPatch: (
    id: string,
    patch: {
      name?: string;
      handle?: string;
      takeCount?: number;
      note?: string;
      projectId?: string | null;
      galleryId?: string | null;
      files?: SlotFileInput[];
    },
  ) => void;
  onDelete: (id: string) => void;
  onSaveAsGallery: (id: string) => void;
  onSaveProjectGallery: (projectId: string) => void;
  onInsert: (handle: string) => void;
  onDropFiles: (id: string, files: File[]) => void;
  onDropHistory: (id: string, ids: string[]) => void;
};

function fileInputs(files: readonly SlotFile[]): SlotFileInput[] {
  return files.map((file) => ({
    kind: file.kind,
    name: file.name,
    key: file.key,
    label: file.label,
    role: file.role,
  }));
}

export function SlotsPanel(props: Props) {
  const [draft, setDraft] = useState("");
  const [pickingId, setPickingId] = useState<string | null>(null);
  const picking = props.open ? (props.slots.find((slot) => slot.id === pickingId) ?? null) : null;
  if (pickingId && !picking) setPickingId(null);
  // One slot open at a time; the rest stay as one-line rows.
  const [openId, setOpenId] = useState<string | null>(null);
  const [known, setKnown] = useState<string[] | null>(null);
  const ids = props.slots.map((slot) => slot.id);
  if (!props.loading && (known === null || known.join("|") !== ids.join("|"))) {
    setKnown(ids);
    const next = openAfterChange(known, ids, openId);
    if (next !== openId) setOpenId(next);
  }
  const toggle = (id: string) => setOpenId((current) => (current === id ? null : id));
  const active = props.projects.find((project) => project.id === props.activeProjectId) ?? null;
  const everywhere = props.slots.filter((slot) => slot.projectId == null);
  const projectSlots = active ? props.slots.filter((slot) => slot.projectId === active.id) : [];
  const otherProjects = props.projects.filter((project) => project.id !== active?.id);
  const groupedOthers = otherProjects.flatMap((project) => {
    const slots = props.slots.filter((slot) => slot.projectId === project.id);
    return slots.length > 0 ? [{ project, slots }] : [];
  });

  function closePicker(id: string) {
    setPickingId(null);
    // Back to the card that opened the picker, with the panel still open.
    requestAnimationFrame(() => document.getElementById(`slot-card-${id}`)?.scrollIntoView({ block: "nearest" }));
  }

  function add(projectId: string | null) {
    const name = draft.trim();
    if (!name) return;
    props.onCreate(projectId, name);
    setDraft("");
  }

  return (
    <aside className={`project-slide slots-panel${props.open ? " is-open" : ""}`} id="slots-panel" aria-label="Slots">
      <div className="project-rail-head">
        <strong>Slots</strong>
        <div className="project-rail-head-actions">
          <PanelPlaceSwitch />
          <button type="button" className="icon-btn sidebar-close" aria-label="Close slots" onClick={props.onClose}>
            ×
          </button>
        </div>
      </div>
      {picking ? (
        <SlotGalleryPicker
          key={picking.id}
          slot={picking}
          galleries={props.galleries}
          onClose={() => closePicker(picking.id)}
          onUseFiles={(files) => {
            props.onPatch(picking.id, { galleryId: null, files });
            closePicker(picking.id);
          }}
          onLinkGallery={(galleryId) => {
            props.onPatch(picking.id, { galleryId });
            closePicker(picking.id);
          }}
        />
      ) : null}
      <div className="slot-body" hidden={Boolean(picking)}>
        <p className="slot-lead">A slot is a name you can type in any prompt. Insert writes @handle at the cursor.</p>
        <form
          className="slot-add"
          onSubmit={(event) => {
            event.preventDefault();
            add(null);
          }}
        >
          <input
            className="field"
            aria-label="New slot name"
            placeholder="Name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="primary-btn" disabled={!draft.trim()}>
            Add
          </button>
        </form>
        {props.notice ? <p className="slot-notice">{props.notice}</p> : null}
        {props.loading ? <Loader label="Loading slots" /> : null}
        {!props.loading && props.slots.length === 0 ? <p className="slot-empty">No slots yet.</p> : null}
        {active ? (
          <SlotGroup
            title={active.name}
            slots={projectSlots}
            addLabel="Add to this project"
            onAdd={draft.trim() ? () => add(active.id) : undefined}
            onSave={() => props.onSaveProjectGallery(active.id)}
            canSave={projectSlots.some((slot) => !slot.galleryId && slot.files.length > 0)}
            {...cardProps(props, setPickingId, openId, toggle)}
          />
        ) : null}
        {everywhere.length > 0 ? (
          <SlotGroup title="Everywhere" slots={everywhere} {...cardProps(props, setPickingId, openId, toggle)} />
        ) : null}
        {groupedOthers.length > 0 ? (
          <details className="slot-folded">
            <summary>{active ? "Other projects" : "In projects"}</summary>
            {groupedOthers.map(({ project, slots }) => (
              <SlotGroup
                key={project.id}
                title={project.name}
                slots={slots}
                onSave={() => props.onSaveProjectGallery(project.id)}
                canSave={slots.some((slot) => !slot.galleryId && slot.files.length > 0)}
                {...cardProps(props, setPickingId, openId, toggle)}
              />
            ))}
          </details>
        ) : null}
      </div>
    </aside>
  );
}

function cardProps(props: Props, onPick: (id: string) => void, openId: string | null, onToggle: (id: string) => void) {
  return {
    projects: props.projects,
    onPick,
    openId,
    onToggle,
    attached: props.attached,
    onPatch: props.onPatch,
    onDelete: props.onDelete,
    onSaveAsGallery: props.onSaveAsGallery,
    onInsert: props.onInsert,
    onDropFiles: props.onDropFiles,
    onDropHistory: props.onDropHistory,
  };
}

function SlotGroup(
  props: {
    title: string;
    slots: StudioSlot[];
    addLabel?: string;
    onAdd?: () => void;
    onSave?: () => void;
    canSave?: boolean;
  } & ReturnType<typeof cardProps>,
) {
  return (
    <section className="slot-group">
      <div className="slot-group-head">
        <h3>{props.title}</h3>
        {props.onAdd ? (
          <button type="button" className="ghost-btn" onClick={props.onAdd}>
            {props.addLabel ?? "Add"}
          </button>
        ) : null}
        {props.onSave ? (
          <button type="button" className="ghost-btn" disabled={!props.canSave} onClick={props.onSave}>
            Save as a gallery
          </button>
        ) : null}
      </div>
      {props.slots.length === 0 ? <p className="slot-empty">None yet.</p> : null}
      {props.slots.map((slot) => (
        <SlotCard
          key={slot.id}
          slot={slot}
          projects={props.projects}
          onPick={props.onPick}
          openId={props.openId}
          onToggle={props.onToggle}
          attached={props.attached}
          onPatch={props.onPatch}
          onDelete={props.onDelete}
          onSaveAsGallery={props.onSaveAsGallery}
          onInsert={props.onInsert}
          onDropFiles={props.onDropFiles}
          onDropHistory={props.onDropHistory}
        />
      ))}
    </section>
  );
}

function SlotCard(
  props: {
    slot: StudioSlot;
  } & ReturnType<typeof cardProps>,
) {
  const { slot } = props;
  const linked = Boolean(slot.galleryId);
  const open = props.openId === slot.id;
  const cover = slot.files[0] ?? null;
  const [name, setName] = useState(slot.name);
  const [handle, setHandle] = useState(slot.handle);
  const [note, setNote] = useState(slot.note);
  const [tracked, setTracked] = useState(slot);
  if (tracked.id !== slot.id) {
    setTracked(slot);
    setName(slot.name);
    setHandle(slot.handle);
    setNote(slot.note);
  } else if (tracked.name !== slot.name || tracked.handle !== slot.handle || tracked.note !== slot.note) {
    setTracked(slot);
    if (tracked.name !== slot.name) setName(slot.name);
    if (tracked.handle !== slot.handle) setHandle(slot.handle);
    if (tracked.note !== slot.note) setNote(slot.note);
  }
  const reorder = useTileReorder({
    items: slot.files,
    onReorder(from, to) {
      props.onPatch(slot.id, { files: fileInputs(moveItem([...slot.files], from, to)) });
    },
  });
  const [over, setOver] = useState(false);
  const spare = props.attached.filter((file) => file.key && !slot.files.some((item) => item.key === file.key));

  function onDragOver(event: DragEvent) {
    if (linked) return;
    if (!fileDragOffered(event.dataTransfer.types) && !historyDragOffered(event.dataTransfer.types)) return;
    event.preventDefault();
    event.stopPropagation();
    setOver(true);
  }

  function onDrop(event: DragEvent) {
    if (linked) return;
    setOver(false);
    if (fileDragOffered(event.dataTransfer.types) && event.dataTransfer.files.length > 0) {
      event.preventDefault();
      event.stopPropagation();
      props.onDropFiles(slot.id, filesFromList(event.dataTransfer.files));
      return;
    }
    const ids = readHistoryDrag(event.dataTransfer);
    if (ids.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    props.onDropHistory(slot.id, ids);
  }

  return (
    <article
      id={`slot-card-${slot.id}`}
      className={`slot-card${open ? " is-open" : ""}${over ? " is-drop" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="slot-row">
        <button
          type="button"
          className="slot-row-toggle"
          aria-expanded={open}
          aria-controls={`slot-body-${slot.id}`}
          onClick={() => props.onToggle(slot.id)}
        >
          <span className="slot-pick-thumb slot-row-thumb">
            {cover ? (
              <GalleryThumb kind={cover.kind} name={cover.name} preview={cover.thumbUrl || cover.url || ""} slot="strip" />
            ) : (
              <span className="slot-row-mark" aria-hidden="true">
                {slot.note.trim() ? "T" : ""}
              </span>
            )}
          </span>
          <span className="slot-row-text">
            <span className="slot-row-name">{slot.name}</span>
            <span className="slot-row-meta">
              @{slot.handle} · {slotRowMeta(slot)}
            </span>
          </span>
          <span className="slot-row-chevron" aria-hidden="true">
            ›
          </span>
        </button>
        <button
          type="button"
          className="ghost-btn slot-insert"
          aria-label={`Insert @${handle.trim() || slot.handle}`}
          title={`Insert @${handle.trim() || slot.handle} at the cursor`}
          onClick={() => props.onInsert(handle.trim() || slot.handle)}
        >
          Insert
        </button>
      </div>
      {open ? (
      <div className="slot-card-body" id={`slot-body-${slot.id}`}>
      <div className="slot-card-name">
        <input
          className="field"
          aria-label={`Name for @${slot.handle}`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const next = name.trim();
            if (next && next !== slot.name) props.onPatch(slot.id, { name: next });
            else setName(slot.name);
          }}
        />
      </div>
      <GalleryMentionFields
        handle={handle}
        take={slot.take}
        handleLabel="Slot handle"
        onHandleChange={setHandle}
        onHandleBlur={() => {
          const next = handle.trim();
          if (next && next !== slot.handle) props.onPatch(slot.id, { handle: next });
          else setHandle(slot.handle);
        }}
        onTakeChange={(takeCount) => props.onPatch(slot.id, { takeCount })}
      />
      <label className="slot-scope">
        <span>Where</span>
        <select
          className="field"
          aria-label={`Where @${slot.handle} works`}
          value={slot.projectId ?? ""}
          onChange={(event) => props.onPatch(slot.id, { projectId: event.target.value || null })}
        >
          <option value="">Everywhere</option>
          {props.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <div className="slot-files" {...reorder.set}>
        {slot.files.map((file, index) => {
          const drag = reorder.tile(index, file);
          return (
            <div
              key={file.id}
              className={`slot-file${drag.dragging ? " is-dragging" : ""}${drag.side ? ` is-drop-${drag.side}` : ""}`}
              {...drag.handlers}
            >
              <GalleryThumb kind={file.kind} name={file.name} preview={file.thumbUrl || file.url || ""} slot="tile" />
              {linked ? (
                file.label ? <span className="slot-label-read">{file.label}</span> : null
              ) : (
                <input
                  className="field"
                  aria-label={`Label for ${file.name}`}
                  placeholder="Label"
                  defaultValue={file.label ?? ""}
                  onBlur={(event) => {
                    const label = event.target.value;
                    if ((file.label ?? "") === label) return;
                    props.onPatch(slot.id, {
                      files: fileInputs(slot.files).map((item) =>
                        item.key === file.key ? { ...item, label: label || null } : item,
                      ),
                    });
                  }}
                />
              )}
              {!linked && file.kind !== "audio" ? (
                <GalleryRoleSelect
                  name={file.name}
                  role={file.role}
                  onChange={(role) =>
                    props.onPatch(slot.id, {
                      files: fileInputs(slot.files).map((item) => (item.key === file.key ? { ...item, role } : item)),
                    })
                  }
                />
              ) : null}
              {!linked ? (
                <button
                  type="button"
                  className="icon-btn gallery-remove"
                  aria-label={`Remove ${file.name}`}
                  onClick={() =>
                    props.onPatch(slot.id, { files: fileInputs(slot.files).filter((item) => item.key !== file.key) })
                  }
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="slot-source">
        <p className="slot-linked">{slotSource(slot)}</p>
        {linked ? (
          <button type="button" className="ghost-btn" onClick={() => props.onPatch(slot.id, { galleryId: null })}>
            Unlink
          </button>
        ) : null}
      </div>
      {!linked ? <p className="slot-drop-hint">Drop files, a library tile, or a canvas result.</p> : null}
      <button type="button" className="ghost-btn slot-pick-open" onClick={() => props.onPick(slot.id)}>
        Add from gallery
      </button>
      {!linked && spare.length > 0 ? (
        <select
          className="field"
          aria-label={`Add an attached file to ${slot.name}`}
          value=""
          onChange={(event) => {
            const key = event.target.value;
            const file = spare.find((item) => item.key === key);
            if (!file) return;
            props.onPatch(slot.id, {
              files: [
                ...fileInputs(slot.files),
                {
                  kind: file.kind,
                  name: file.name,
                  key: file.key,
                  role: file.kind === "audio" ? null : normalizeMediaRole(file.role),
                },
              ],
            });
          }}
        >
          <option value="">From the prompt</option>
          {spare.map((file) => (
            <option key={file.key} value={file.key}>
              {file.name}
            </option>
          ))}
        </select>
      ) : null}
      <label className="slot-note">
        <span>Note</span>
        <textarea
          className="field"
          aria-label={`Note for @${slot.handle}`}
          value={note}
          maxLength={2000}
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => {
            if (note !== slot.note) props.onPatch(slot.id, { note });
          }}
        />
      </label>
      <div className="slot-card-actions">
        <button
          type="button"
          className="ghost-btn"
          disabled={linked || slot.files.length === 0}
          onClick={() => props.onSaveAsGallery(slot.id)}
        >
          Save as gallery
        </button>
        <button type="button" className="ghost-btn" onClick={() => props.onDelete(slot.id)}>
          Delete
        </button>
      </div>
      </div>
      ) : null}
    </article>
  );
}
