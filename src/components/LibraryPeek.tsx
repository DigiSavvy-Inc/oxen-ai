import { useState } from "react";
import { MODE_LABELS, type Generation, type GenerationMode } from "../lib/api";
import { isActiveGeneration } from "../lib/batches";
import { libraryRefFromGeneration } from "../lib/library-refs";
import { CopyPrompt } from "./CopyPrompt";
import { ExpandCorners, FullSizeMedia } from "./FullSizeMedia";
import { Loader } from "./Loader";
import { MediaDeleteGroup } from "./MediaDeleteGroup";

export function LibraryPeek({
  generation,
  variants,
  attachedIds,
  attachSupported,
  onClose,
  onAttach,
  onSelectVariant,
  onDownload,
  onRemove,
}: {
  generation: Generation;
  variants: Generation[];
  attachedIds: Set<string>;
  attachSupported: boolean;
  onClose: () => void;
  onAttach: (item: Generation) => void;
  onSelectVariant: (id: string) => void;
  onDownload?: () => void;
  onRemove?: (ids: string[], fromOxen?: boolean) => void;
}) {
  const label = MODE_LABELS[generation.mode as GenerationMode] || generation.mode;
  const ready = Boolean(libraryRefFromGeneration(generation));
  const canAttach = ready && attachSupported;
  const attached = attachedIds.has(generation.id);
  const showStrip = variants.length > 1;
  const [fullSize, setFullSize] = useState<Generation | null>(null);
  const kindLabel =
    generation.mediaType === "video"
      ? "video"
      : generation.mediaType === "audio"
        ? "audio"
        : "images";

  function attach(item: Generation) {
    if (!libraryRefFromGeneration(item) || !attachSupported) return;
    onSelectVariant(item.id);
    onAttach(item);
  }

  function remove(item: Generation, fromOxen = false) {
    onRemove?.([item.id], fromOxen);
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
          <div className="library-peek-frame">
            {generation.mediaType === "video" && generation.resultUrl ? (
              <video src={generation.resultUrl} controls playsInline />
            ) : generation.resultUrl ? (
              <button
                type="button"
                className="library-peek-hit"
                onClick={() => setFullSize(generation)}
                title="View full size"
                aria-label="View full size"
              >
                <img src={generation.resultUrl} alt={generation.prompt || "Library item"} />
                <ExpandCorners />
              </button>
            ) : isActiveGeneration(generation) ? (
              <Loader size="md" label={generation.status} />
            ) : (
              <span className="library-peek-missing">
                {generation.status === "succeeded" ? "Media unavailable" : generation.status}
              </span>
            )}
            {onRemove ? (
              <MediaDeleteGroup
                onStudio={() => remove(generation)}
                onOxen={() => remove(generation, true)}
              />
            ) : null}
          </div>
          {ready ? (
            <button
              type="button"
              className="library-peek-action"
              onClick={() => attach(generation)}
              disabled={!canAttach}
              title={
                canAttach
                  ? "Attach as reference"
                  : `This model doesn't accept ${kindLabel}`
              }
            >
              {attached
                ? "Attached"
                : canAttach
                  ? "Click to attach"
                  : `Can't attach ${kindLabel}`}
            </button>
          ) : null}
        </div>
        {showStrip ? (
          <div className="library-peek-thumbs" role="list" aria-label="Variations">
            {variants.map((item, index) => {
              const variantReady = Boolean(libraryRefFromGeneration(item));
              const isCurrent = item.id === generation.id;
              const isAttached = attachedIds.has(item.id);
              return (
                <div
                  key={item.id}
                  role="listitem"
                  className={`library-peek-thumb${isCurrent ? " active" : ""}${isAttached ? " is-attached" : ""}`}
                >
                  <button
                    type="button"
                    className="library-peek-thumb-hit"
                    disabled={!variantReady}
                    title={variantReady ? `Show variation ${index + 1}` : `Variation ${index + 1}`}
                    aria-label={
                      variantReady
                        ? `Show variation ${index + 1}`
                        : `Variation ${index + 1}, ${item.status}`
                    }
                    aria-current={isCurrent ? "true" : undefined}
                    onClick={() => onSelectVariant(item.id)}
                  >
                    {item.thumbUrl ? (
                      <img src={item.thumbUrl} alt="" />
                    ) : item.resultUrl && item.mediaType === "video" ? (
                      <video src={item.resultUrl} muted playsInline preload="metadata" />
                    ) : item.resultUrl ? (
                      <img src={item.resultUrl} alt="" />
                    ) : (
                      <span>{index + 1}</span>
                    )}
                  </button>
                  {onRemove ? (
                    <MediaDeleteGroup oxen={false} onStudio={() => remove(item)} />
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {fullSize?.resultUrl ? (
          <FullSizeMedia
            src={fullSize.resultUrl}
            alt={fullSize.prompt || "Library item"}
            onClose={() => setFullSize(null)}
          />
        ) : null}
        {onDownload || onRemove ? (
          <div className="library-peek-tools">
            {onDownload && generation.resultUrl ? (
              <button type="button" className="ghost-btn" onClick={onDownload}>
                Download
              </button>
            ) : null}
            {onRemove ? (
              <>
                <button
                  type="button"
                  className="ghost-btn library-peek-remove"
                  onClick={() => remove(generation)}
                >
                  Delete
                </button>
                <button
                  type="button"
                  className="ghost-btn library-peek-remove"
                  onClick={() => remove(generation, true)}
                >
                  Delete + Oxen
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {generation.prompt ? (
          <CopyPrompt prompt={generation.prompt} className="library-peek-prompt" />
        ) : null}
      </div>
    </aside>
  );
}
