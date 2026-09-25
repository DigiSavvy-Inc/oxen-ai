import { useEffect, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import type { GallerySummary } from "../lib/api";
import { shortenFileName } from "../lib/files";
import { indexAfterInsertBefore } from "../lib/mentions";

export type GalleryDraftItem = {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  preview: string;
  key: string;
  url: string;
};

type Props = {
  name: string;
  onNameChange: (value: string) => void;
  items: GalleryDraftItem[];
  summaries: GallerySummary[];
  saving: boolean;
  adding: boolean;
  status: string | null;
  skipped: string[];
  onAddFiles: (files: FileList | File[] | null) => void;
  onRemove: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  onSave: () => void;
  onLoad: (id: string) => void;
  onAttach: () => void;
  onClose: () => void;
};

function isFileDrag(event: DragEvent) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function GalleryDrawer(props: Props) {
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropInsertBefore, setDropInsertBefore] = useState<number | null>(null);
  const [fileHover, setFileHover] = useState(false);
  const query = search.trim().toLowerCase();
  const matches = query
    ? props.summaries.filter((item) => item.name.toLowerCase().includes(query))
    : props.summaries;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 860px)");
    const sync = () => setPhone(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  function onDragOverFiles(event: DragEvent) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setFileHover(true);
  }

  function onDropFiles(event: DragEvent) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setFileHover(false);
    props.onAddFiles(event.dataTransfer.files);
  }

  const drawer = (
    <aside
      id="gallery-drawer"
      className={`gallery-drawer${phone ? " is-sheet" : ""}${fileHover ? " is-file-target" : ""}`}
      aria-label="Gallery"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      }}
      onDragOver={onDragOverFiles}
      onDragLeave={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setFileHover(false);
      }}
      onDrop={onDropFiles}
    >
      <div className="gallery-drawer-head">
        <input
          className="field gallery-name"
          value={props.name}
          placeholder="Name"
          aria-label="Gallery name"
          onChange={(event) => props.onNameChange(event.target.value)}
        />
        <button type="button" className="gallery-close" aria-label="Close gallery" onClick={props.onClose}>
          ×
        </button>
      </div>
      <div className="gallery-search">
        <input
          className="field gallery-search-input"
          value={search}
          placeholder="Search"
          aria-label="Search galleries"
          aria-expanded={searchOpen}
          aria-controls="gallery-search-results"
          onChange={(event) => {
            setSearch(event.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => setSearchOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setSearchOpen(false), 120);
          }}
        />
        {searchOpen ? (
          <div id="gallery-search-results" className="gallery-search-results" role="listbox">
            {matches.length === 0 ? (
              <p className="gallery-search-empty">{query ? "No galleries" : "No saved galleries yet"}</p>
            ) : (
              matches.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="gallery-search-option"
                  role="option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSearch("");
                    setSearchOpen(false);
                    props.onLoad(item.id);
                  }}
                >
                  {item.name}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
      <div className="gallery-actions">
        <button
          type="button"
          className="ghost-btn"
          disabled={!props.name.trim() || props.saving || props.adding}
          onClick={props.onSave}
        >
          {props.saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={props.items.length === 0}
          onMouseDown={(event) => event.preventDefault()}
          onClick={props.onAttach}
        >
          Attach
        </button>
      </div>
      {props.skipped.length > 0 ? (
        <p className="gallery-skipped">Skipped {props.skipped.join(", ")}</p>
      ) : null}
      {props.status ? <p className="gallery-status">{props.status}</p> : null}
      <div
        className="gallery-grid"
        onDragOver={(event) => {
          if (isFileDrag(event) || dragIndex == null) return;
          event.preventDefault();
        }}
        onDrop={(event) => {
          if (isFileDrag(event)) return;
          event.preventDefault();
          const from = Number(event.dataTransfer.getData("text/plain"));
          const insertBefore = dropInsertBefore ?? props.items.length;
          setDragIndex(null);
          setDropInsertBefore(null);
          if (!Number.isInteger(from)) return;
          props.onReorder(from, indexAfterInsertBefore(from, insertBefore));
        }}
      >
        {props.items.map((item, index) => (
          <div
            key={item.id}
            className={`gallery-tile${dragIndex === index ? " is-dragging" : ""}`}
            draggable
            onDragStart={(event) => {
              if ((event.target as HTMLElement).closest("button")) {
                event.preventDefault();
                return;
              }
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", String(index));
              setDragIndex(index);
            }}
            onDragOver={(event) => {
              if (isFileDrag(event)) return;
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              const insertBefore = event.clientX < rect.left + rect.width / 2 ? index : index + 1;
              if (dropInsertBefore !== insertBefore) setDropInsertBefore(insertBefore);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setDropInsertBefore(null);
            }}
          >
            {item.kind === "image" ? (
              <img src={item.preview} alt="" draggable={false} />
            ) : item.kind === "video" ? (
              <video src={item.preview} muted playsInline draggable={false} />
            ) : (
              <span className="gallery-audio">{shortenFileName(item.name, 16)}</span>
            )}
            <button
              type="button"
              className="gallery-remove"
              aria-label={`Remove ${item.name}`}
              onClick={() => props.onRemove(index)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <label className={`gallery-drop${fileHover ? " is-hot" : ""}`}>
        {props.adding ? "Adding…" : "Drop images, video, or audio"}
        <input
          type="file"
          accept="image/*,video/*,audio/*"
          multiple
          onChange={(event) => {
            props.onAddFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </label>
    </aside>
  );

  if (phone && typeof document !== "undefined") return createPortal(drawer, document.body);
  return drawer;
}
