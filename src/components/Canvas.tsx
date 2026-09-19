import { MODE_LABELS, type Generation, type GenerationMode } from "../lib/api";

function MediaPreview({
  generation,
  className,
}: {
  generation: Generation;
  className?: string;
}) {
  if (generation.status === "succeeded" && generation.resultUrl) {
    if (generation.mediaType === "video") {
      return <video className={className} src={generation.resultUrl} controls autoPlay loop />;
    }
    return (
      <img
        className={className}
        src={generation.resultUrl}
        alt={generation.prompt || "Generated"}
      />
    );
  }
  if (generation.status === "succeeded") {
    return (
      <div className="status-block">
        Media unavailable
        <div style={{ marginTop: 8, fontSize: 12 }}>
          The job finished, but the file is not in the library yet. It should appear after the next
          refresh.
        </div>
      </div>
    );
  }
  if (generation.status === "failed") {
    return (
      <div className="status-block">
        Generation failed
        <div style={{ marginTop: 8, color: "var(--danger)" }}>
          {generation.errorMessage || "Unknown error"}
        </div>
      </div>
    );
  }
  return (
    <div className="status-block">
      {generation.status === "queued" ? "Queued on Oxen…" : "Generating…"}
      {generation.errorMessage ? (
        <div style={{ marginTop: 8, color: "var(--danger)" }}>{generation.errorMessage}</div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-dim)" }}>
          Video jobs can take several minutes. This view polls automatically.
        </div>
      )}
    </div>
  );
}

export function Canvas({
  generation,
  variants,
  onSelect,
}: {
  generation: Generation | null;
  variants: Generation[];
  onSelect: (id: string) => void;
}) {
  if (!generation) {
    return (
      <div className="canvas">
        <div className="canvas-empty">
          <h2>What do you want to make?</h2>
          <p>
            Pick a mode, choose a model, and describe the image or video. Generations queue on Oxen
            and appear here when ready.
          </p>
        </div>
      </div>
    );
  }

  const label = MODE_LABELS[generation.mode as GenerationMode] || generation.mode;
  const showStrip = variants.length > 1;

  return (
    <div className="canvas">
      <div className="result-frame">
        <div className="frame-head">
          <h3>
            {label} · {generation.model}
          </h3>
          <span className={`pill ${generation.status === "succeeded" ? "ok" : "warn"}`}>
            {generation.status}
          </span>
        </div>
        <div className={`result-stage${showStrip ? " has-strip" : ""}`}>
          <div className="result-media">
            <MediaPreview generation={generation} />
          </div>
          {showStrip ? (
            <div className="variation-strip" role="list">
              {variants.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="listitem"
                  className={`variation-thumb${item.id === generation.id ? " active" : ""}`}
                  onClick={() => onSelect(item.id)}
                  title={`Variation ${index + 1}`}
                >
                  {item.resultUrl && item.mediaType === "image" ? (
                    <img src={item.resultUrl} alt="" />
                  ) : item.resultUrl && item.mediaType === "video" ? (
                    <video src={item.resultUrl} muted />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {generation.prompt ? (
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>{generation.prompt}</p>
        ) : null}
      </div>
    </div>
  );
}
