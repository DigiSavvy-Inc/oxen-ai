import { MODE_LABELS, type Generation, type GenerationMode } from "../lib/api";

export function Canvas({ generation }: { generation: Generation | null }) {
  if (!generation) {
    return (
      <div className="canvas">
        <div className="canvas-empty">
          <h2>What do you want to make?</h2>
          <p>
            Pick a mode, choose a model, and describe the image or video. Generations
            queue on Oxen and appear here when ready.
          </p>
        </div>
      </div>
    );
  }

  const label = MODE_LABELS[generation.mode as GenerationMode] || generation.mode;

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
        <div className="result-media">
          {generation.status === "succeeded" && generation.resultUrl ? (
            generation.mediaType === "video" ? (
              <video src={generation.resultUrl} controls autoPlay loop />
            ) : (
              <img src={generation.resultUrl} alt={generation.prompt || "Generated"} />
            )
          ) : generation.status === "failed" ? (
            <div className="status-block">
              Generation failed
              <div style={{ marginTop: 8, color: "var(--danger)" }}>
                {generation.errorMessage || "Unknown error"}
              </div>
            </div>
          ) : (
            <div className="status-block">
              {generation.status === "queued" ? "Queued on Oxen…" : "Generating…"}
              {generation.errorMessage ? (
                <div style={{ marginTop: 8, color: "var(--danger)" }}>
                  {generation.errorMessage}
                </div>
              ) : (
                <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-dim)" }}>
                  Video jobs can take several minutes. This view polls automatically.
                </div>
              )}
            </div>
          )}
        </div>
        {generation.prompt ? (
          <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>
            {generation.prompt}
          </p>
        ) : null}
      </div>
    </div>
  );
}
