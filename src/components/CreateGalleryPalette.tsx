import { useEffect, useRef, useState, type DragEvent } from "react";
import { shortenFileName } from "../lib/files";
import type { GalleryDraftItem } from "./GalleryDrawer";

type Props = {
  name: string;
  onNameChange: (value: string) => void;
  items: GalleryDraftItem[];
  saving: boolean;
  adding: boolean;
  status: string | null;
  accept: string;
  dropLabel: string;
  onAddFiles: (files: FileList | File[] | null) => void;
  onRemove: (index: number) => void;
  onSave: () => void;
  onClose: () => void;
};

function isFileDrag(event: DragEvent) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function CreateGalleryPalette(props: Props) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [fileHover, setFileHover] = useState(false);
  const canSave = Boolean(props.name.trim()) && props.items.length > 0 && !props.saving && !props.adding;

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  function save() {
    if (!canSave) return;
    props.onSave();
  }

  function onDragOver(event: DragEvent) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setFileHover(true);
  }

  function onDrop(event: DragEvent) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setFileHover(false);
    props.onAddFiles(event.dataTransfer.files);
  }

  return (
    <aside
      id="create-gallery"
      className={`create-gallery${fileHover ? " is-file-target" : ""}`}
      aria-label="Create gallery"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        props.onClose();
      }}
      onDragOver={onDragOver}
      onDragLeave={(event) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        setFileHover(false);
      }}
      onDrop={onDrop}
    >
      <div className="create-gallery-head">
        <input
          ref={nameRef}
          className="field gallery-name"
          value={props.name}
          placeholder="Gallery name"
          aria-label="Gallery name"
          autoComplete="off"
          onChange={(event) => props.onNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            save();
          }}
        />
        <button type="button" className="gallery-close" aria-label="Close create gallery" onClick={props.onClose}>
          ×
        </button>
      </div>
      <p className="create-gallery-hint">
        {props.items.length === 0 ? "Select tiles, or drop media" : `${props.items.length} selected`}
      </p>
      {props.items.length > 0 ? (
        <div className="create-gallery-items">
          {props.items.map((item, index) => (
            <div key={item.id} className="create-gallery-thumb">
              {item.kind === "image" ? (
                <img src={item.preview} alt="" />
              ) : item.kind === "video" ? (
                <video src={item.preview} muted playsInline />
              ) : (
                <span className="gallery-audio">{shortenFileName(item.name, 12)}</span>
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
      ) : null}
      {props.accept ? (
        <label className={`gallery-drop create-gallery-drop${fileHover ? " is-hot" : ""}`}>
          {props.adding ? "Adding…" : props.dropLabel || "Drop media"}
          <input
            type="file"
            accept={props.accept}
            multiple
            onChange={(event) => {
              props.onAddFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      ) : null}
      <button type="button" className="ghost-btn create-gallery-save" disabled={!canSave} onClick={save}>
        {props.saving ? "Saving…" : "Save"}
      </button>
      {props.status ? <p className="gallery-status">{props.status}</p> : null}
    </aside>
  );
}
