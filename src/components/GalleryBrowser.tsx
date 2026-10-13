import { useState } from "react";
import type { GallerySummary } from "../lib/api";
import type { GalleryDraftItem } from "./GalleryDrawer";
import { GalleryThumb } from "./GalleryThumb";

type Props = {
  summaries: GallerySummary[];
  detail: boolean;
  name: string;
  items: GalleryDraftItem[];
  saving: boolean;
  status: string | null;
  onOpen: (id: string) => void;
  onBack: () => void;
  onNameChange: (value: string) => void;
  onSave: () => void;
  onAttach: (items?: GalleryDraftItem[]) => string[];
  onRemove: (index: number) => void;
  onFeature: (index: number) => void;
  onDelete: () => void;
};

export function GalleryBrowser(props: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);

  if (!props.detail) {
    return (
      <div className="gallery-browser" aria-label="Galleries">
        {props.summaries.length === 0 ? (
          <div className="history-empty">No galleries yet. Create one, then pick library tiles.</div>
        ) : (
          <div className="gallery-card-list">
            {props.summaries.map((gallery) => {
              const previews = gallery.previews ?? [];
              const count = gallery.count ?? previews.length;
              return (
                <button
                  key={gallery.id}
                  type="button"
                  className="gallery-card"
                  onClick={() => props.onOpen(gallery.id)}
                >
                  <span className="gallery-card-mosaic">
                    {previews.length === 0 ? (
                      <span className="gallery-card-thumb">
                        <span className="gallery-audio">Empty</span>
                      </span>
                    ) : (
                      previews.map((item, index) => (
                        <span key={`${gallery.id}-${index}`} className="gallery-card-thumb">
                          {item.thumbUrl ? (
                            <GalleryThumb
                              kind={item.kind}
                              name={item.name}
                              preview={item.thumbUrl}
                              slot="strip"
                            />
                          ) : (
                            <span className="gallery-audio">
                              {item.kind === "video" ? "Video" : item.kind === "audio" ? "Audio" : "Image"}
                            </span>
                          )}
                        </span>
                      ))
                    )}
                  </span>
                  <span className="gallery-card-meta">
                    <span className="gallery-card-name">{gallery.name}</span>
                    <span className="gallery-card-count">
                      {count} {count === 1 ? "item" : "items"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  const canSave = Boolean(props.name.trim()) && !props.saving;

  return (
    <div className="gallery-browser" aria-label="Gallery">
      <div className="gallery-manage-head">
        <button type="button" className="ghost-btn" onClick={props.onBack}>
          Galleries
        </button>
        <input
          className="field gallery-name"
          value={props.name}
          placeholder="Gallery name"
          aria-label="Gallery name"
          onChange={(event) => props.onNameChange(event.target.value)}
        />
      </div>
      <div className="gallery-manage-actions">
        <button type="button" className="ghost-btn" disabled={!canSave} onClick={props.onSave}>
          {props.saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={props.items.length === 0}
          onClick={() => setSkipped(props.onAttach())}
        >
          Attach all
        </button>
        {confirmDelete ? (
          <button
            type="button"
            className="ghost-btn gallery-delete"
            onClick={() => {
              setConfirmDelete(false);
              props.onDelete();
            }}
          >
            Delete this gallery
          </button>
        ) : (
          <button type="button" className="ghost-btn" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
      </div>
      {skipped.length > 0 ? <p className="gallery-skipped">Skipped {skipped.join(", ")}</p> : null}
      {props.status ? <p className="gallery-status">{props.status}</p> : null}
      {props.items.length === 0 ? (
        <div className="history-empty">This gallery is empty.</div>
      ) : (
        <div className="gallery-manage-grid">
          {props.items.map((item, index) => (
            <div key={item.id} className="gallery-manage-tile">
              <GalleryThumb kind={item.kind} name={item.name} preview={item.preview} slot="tile" />
              <button
                type="button"
                className="gallery-remove"
                aria-label={`Remove ${item.name}`}
                onClick={() => props.onRemove(index)}
              >
                ×
              </button>
              <div className="gallery-tile-actions">
                <button
                  type="button"
                  className="gallery-attach-one"
                  onClick={() => setSkipped(props.onAttach([item]))}
                >
                  Attach
                </button>
                {index > 0 && item.kind === "image" ? (
                  <button type="button" className="gallery-feature" onClick={() => props.onFeature(index)}>
                    Feature
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
