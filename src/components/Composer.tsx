import {
  ALL_MODES,
  MODE_LABELS,
  modeIsVideo,
  modeNeedsImage,
  modeNeedsVideo,
  type GenerationMode,
  type OxenModel,
} from "../lib/api";

type Props = {
  mode: GenerationMode;
  onModeChange: (mode: GenerationMode) => void;
  models: OxenModel[];
  model: string;
  onModelChange: (model: string) => void;
  prompt: string;
  onPromptChange: (value: string) => void;
  aspectRatio: string;
  onAspectRatioChange: (value: string) => void;
  duration: number;
  onDurationChange: (value: number) => void;
  seed: string;
  onSeedChange: (value: string) => void;
  imageName: string | null;
  videoName: string | null;
  imagePreview: string | null;
  videoPreview: string | null;
  onPickImage: (file: File | null) => void;
  onPickVideo: (file: File | null) => void;
  onClearImage: () => void;
  onClearVideo: () => void;
  busy: boolean;
  error: string | null;
  onGenerate: () => void;
  canGenerate: boolean;
};

export function Composer(props: Props) {
  return (
    <div className="composer">
      <div className="composer-inner">
        <div className="mode-row">
          {ALL_MODES.map((m) => (
            <button
              key={m}
              type="button"
              className={`mode-chip${props.mode === m ? " active" : ""}`}
              onClick={() => props.onModeChange(m)}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        <textarea
          value={props.prompt}
          onChange={(e) => props.onPromptChange(e.target.value)}
          placeholder={
            props.mode === "image-to-image"
              ? "Describe the edit…"
              : props.mode === "video-to-video"
                ? "Describe how to edit the video…"
                : "Describe what to generate…"
          }
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && props.canGenerate) {
              e.preventDefault();
              props.onGenerate();
            }
          }}
        />

        {(props.imagePreview || props.videoPreview) && (
          <div className="attach-preview">
            {props.imagePreview ? (
              <div className="attach-chip">
                <img src={props.imagePreview} alt="" />
                <span>{props.imageName || "image"}</span>
                <button className="ghost-btn" type="button" onClick={props.onClearImage}>
                  Remove
                </button>
              </div>
            ) : null}
            {props.videoPreview ? (
              <div className="attach-chip">
                <video src={props.videoPreview} muted />
                <span>{props.videoName || "video"}</span>
                <button className="ghost-btn" type="button" onClick={props.onClearVideo}>
                  Remove
                </button>
              </div>
            ) : null}
          </div>
        )}

        {props.error ? <div className="error-banner">{props.error}</div> : null}

        <div className="composer-toolbar">
          <select
            className="select"
            value={props.model}
            onChange={(e) => props.onModelChange(e.target.value)}
          >
            {props.models.length === 0 ? (
              <option value="">No models</option>
            ) : (
              props.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name || m.id}
                </option>
              ))
            )}
          </select>

          <select
            className="select"
            value={props.aspectRatio}
            onChange={(e) => props.onAspectRatioChange(e.target.value)}
          >
            {(modeIsVideo(props.mode)
              ? ["16:9", "9:16", "1:1"]
              : ["1:1", "16:9", "9:16", "4:3", "3:4"]
            ).map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>

          {modeIsVideo(props.mode) ? (
            <input
              className="field"
              type="number"
              min={1}
              max={20}
              value={props.duration}
              onChange={(e) => props.onDurationChange(Number(e.target.value) || 5)}
              title="Duration (seconds)"
              style={{ width: 72 }}
            />
          ) : null}

          <input
            className="field"
            type="text"
            inputMode="numeric"
            placeholder="seed"
            value={props.seed}
            onChange={(e) => props.onSeedChange(e.target.value)}
            style={{ width: 88 }}
          />

          {modeNeedsImage(props.mode) || props.mode === "video-to-video" ? (
            <label className="ghost-btn attach">
              Image
              <input
                type="file"
                accept="image/*"
                onChange={(e) => props.onPickImage(e.target.files?.[0] ?? null)}
              />
            </label>
          ) : null}

          {modeNeedsVideo(props.mode) ? (
            <label className="ghost-btn attach">
              Video
              <input
                type="file"
                accept="video/*"
                onChange={(e) => props.onPickVideo(e.target.files?.[0] ?? null)}
              />
            </label>
          ) : null}

          <button
            type="button"
            className="primary-btn"
            disabled={!props.canGenerate || props.busy}
            onClick={props.onGenerate}
          >
            {props.busy ? "Queuing…" : "Generate ⌘↵"}
          </button>
        </div>
      </div>
    </div>
  );
}
