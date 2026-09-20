import { MODE_LABELS, type Generation, type GenerationMode } from "../lib/api";
import { libraryRefFromGeneration } from "../lib/library-refs";

export function LibraryPeek({
  generation,
  variants,
  attachedIds,
  onClose,
  onAttach,
  onSelectVariant,
  onDownload,
  onRemove,
}: {
  generation: Generation;
  variants: Generation[];
  attachedIds: Set<string>;
  onClose: () => void;
  onAttach: (item: Generation) => void;
  onSelectVariant: (id: string) => void;
  onDownload?: () => void;
  onRemove?: () => void;
}) {
  const label = MODE_LABELS[generation.mode as GenerationMode] || generation.mode;
  const canAttach = Boolean(libraryRefFromGeneration(generation));
  const attached = attachedIds.has(generation.id);
  const showStrip = variants.length > 1;

  function attach(item: Generation) {
    if (!libraryRefFromGeneration(item)) return;
    onSelectVariant(item.id);
    onAttach(item);
  }

  return (
    <aside className="library-peek" aria-label="Library item">
      <div className="library-peek-head">
        <div className="library-peek-copy">
          <strong>{label}</strong>
          <span>{generation.model}</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close library item"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="library-peek-body">
        <div className={`library-peek-media${attached ? " is-attached" : ""}`}>
          {generation.mediaType === "video" && generation.resultUrl ? (
            <video src={generation.resultUrl} controls playsInline />
          ) : generation.resultUrl ? (
            <button
              type="button"
              className="library-peek-hit"
              onClick={() => attach(generation)}
              disabled={!canAttach}
              title="Attach as reference"
            >
              <img src={generation.resultUrl} alt={generation.prompt || "Library item"} />
            </button>
          ) : (
            <span className="library-peek-missing">
              {generation.status === "succeeded" ? "Media unavailable" : generation.status}
            </span>
          )}
          {canAttach ? (
            <button
              type="button"
              className="library-peek-action"
              onClick={() => attach(generation)}
            >
              {attached ? "Attached" : "Click to attach"}
            </button>
          ) : null}
        </div>
        {onDownload || onRemove ? (
          <div className="library-peek-tools">
            {onDownload && generation.resultUrl ? (
              <button type="button" className="ghost-btn" onClick={onDownload}>
                Download
              </button>
            ) : null}
            {onRemove ? (
              <button type="button" className="ghost-btn library-peek-remove" onClick={onRemove}>
                Remove
              </button>
            ) : null}
          </div>
        ) : null}
        {generation.prompt ? <p className="library-peek-prompt">{generation.prompt}</p> : null}
        {showStrip ? (
          <div className="library-peek-thumbs" role="list" aria-label="Variations">
            {variants.map((item, index) => {
              const ready = Boolean(libraryRefFromGeneration(item));
              const isCurrent = item.id === generation.id;
              const isAttached = attachedIds.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="listitem"
                  className={`library-peek-thumb${isCurrent ? " active" : ""}${isAttached ? " is-attached" : ""}`}
                  disabled={!ready}
                  title={ready ? `Show variation ${index + 1}` : `Variation ${index + 1}`}
                  aria-label={
                    ready
                      ? `Show variation ${index + 1}`
                      : `Variation ${index + 1}, ${item.status}`
                  }
                  onClick={() => onSelectVariant(item.id)}
                >
                  {item.thumbUrl ? (
                    <img src={item.thumbUrl} alt="" />
                  ) : item.resultUrl && item.mediaType === "video" ? (
                    <video src={item.resultUrl} muted playsInline preload="metadata" />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
