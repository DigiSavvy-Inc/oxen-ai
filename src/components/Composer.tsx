import {
  ALL_MODES,
  MODE_LABELS,
  slotMax,
  slotRequired,
  type GenerationMode,
  type ModelControls,
  type OxenModel,
} from "../lib/api";

type AttachItem = {
  name: string;
  preview: string;
  kind: "image" | "video" | "audio";
};

type Props = {
  mode: GenerationMode;
  onModeChange: (mode: GenerationMode) => void;
  models: OxenModel[];
  preferred: OxenModel[];
  model: string;
  onModelChange: (model: string) => void;
  modelQuery: string;
  onModelQueryChange: (value: string) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  controls: ModelControls | null;
  prompt: string;
  onPromptChange: (value: string) => void;
  aspectRatio: string;
  onAspectRatioChange: (value: string) => void;
  duration: string;
  onDurationChange: (value: string) => void;
  seed: string;
  onSeedChange: (value: string) => void;
  numGenerations: number;
  onNumGenerationsChange: (value: number) => void;
  generateAudio: boolean;
  onGenerateAudioChange: (value: boolean) => void;
  quality: string;
  onQualityChange: (value: string) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
  outputFormat: string;
  onOutputFormatChange: (value: string) => void;
  background: string;
  onBackgroundChange: (value: string) => void;
  attachments: AttachItem[];
  onPickFiles: (kind: "image" | "video" | "audio", files: FileList | null) => void;
  onClearAttachment: (kind: "image" | "video" | "audio", index: number) => void;
  busy: boolean;
  error: string | null;
  onGenerate: () => void;
  canGenerate: boolean;
};

function modelLabel(model: OxenModel): string {
  return model.display_name || model.id;
}

export function Composer(props: Props) {
  const preferredIds = new Set(props.preferred.map((model) => model.id));
  const preferredInMode = props.models.filter((model) => preferredIds.has(model.id));
  const rest = props.models.filter((model) => !preferredIds.has(model.id));
  const imageMax = Math.max(slotMax(props.controls, "image"), props.mode === "image-to-image" ? 1 : 0);
  const videoMax = Math.max(
    slotMax(props.controls, "video"),
    props.mode === "video-to-video" ? 1 : 0,
  );
  const audioMax = slotMax(props.controls, "audio");
  const showImage =
    imageMax > 0 ||
    props.mode === "image-to-image" ||
    props.mode === "reference-to-video" ||
    props.mode === "video-to-video";
  const showVideo = videoMax > 0 || props.mode === "video-to-video";
  const aspectOptions =
    props.controls?.aspectRatios && props.controls.aspectRatios.length > 0
      ? props.controls.aspectRatios
      : props.mode.includes("video")
        ? ["16:9", "9:16", "1:1"]
        : ["1:1", "16:9", "9:16", "4:3", "3:4"];

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
              ? "Describe the edit… use @Image1 for references"
              : props.mode === "video-to-video"
                ? "Describe how to edit the video…"
                : props.mode === "reference-to-video"
                  ? "Describe the shot… use @Image1 / @Video1 if you attach refs"
                  : "Describe what to generate…"
          }
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && props.canGenerate) {
              e.preventDefault();
              props.onGenerate();
            }
          }}
        />

        {props.attachments.length > 0 ? (
          <div className="attach-preview">
            {props.attachments.map((item, index) => (
              <div className="attach-chip" key={`${item.kind}-${item.name}-${index}`}>
                {item.kind === "image" ? (
                  <img src={item.preview} alt="" />
                ) : item.kind === "video" ? (
                  <video src={item.preview} muted />
                ) : (
                  <span className="pill">AUD</span>
                )}
                <span>{item.name}</span>
                <button
                  className="ghost-btn"
                  type="button"
                  onClick={() => props.onClearAttachment(item.kind, index)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {props.error ? <div className="error-banner">{props.error}</div> : null}

        <div className="composer-toolbar">
          <input
            className="field model-search"
            type="search"
            placeholder="Search models"
            value={props.modelQuery}
            onChange={(e) => props.onModelQueryChange(e.target.value)}
          />
          <select
            className="select select-model"
            value={props.model}
            onChange={(e) => props.onModelChange(e.target.value)}
          >
            <option value="">Select a model</option>
            {preferredInMode.length > 0 ? (
              <optgroup label="Preferred">
                {preferredInMode.map((m) => (
                  <option key={`fav-${m.id}`} value={m.id}>
                    {modelLabel(m)}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {rest.length > 0 ? (
              <optgroup label={preferredInMode.length > 0 ? "All" : "Models"}>
                {rest.map((m) => (
                  <option key={m.id} value={m.id}>
                    {modelLabel(m)}
                  </option>
                ))}
              </optgroup>
            ) : preferredInMode.length === 0 ? (
              props.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {modelLabel(m)}
                </option>
              ))
            ) : null}
            {props.model && !props.models.some((item) => item.id === props.model) ? (
              <option value={props.model}>{props.model}</option>
            ) : null}
          </select>
          <button
            type="button"
            className={`ghost-btn star-btn${props.isFavorite ? " active" : ""}`}
            onClick={props.onToggleFavorite}
            disabled={!props.model}
            title={props.isFavorite ? "Remove from Oxen favorites" : "Add to Oxen favorites"}
          >
            {props.isFavorite ? "★" : "☆"}
          </button>

          <select
            className="select"
            value={aspectOptions.includes(props.aspectRatio) ? props.aspectRatio : aspectOptions[0]}
            onChange={(e) => props.onAspectRatioChange(e.target.value)}
          >
            {aspectOptions.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>

          {props.controls?.duration ? (
            props.controls.duration.kind === "enum" ? (
              <select
                className="select"
                value={props.duration}
                onChange={(e) => props.onDurationChange(e.target.value)}
                title="Duration"
              >
                {props.controls.duration.values.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="field"
                type="number"
                min={props.controls.duration.min}
                max={props.controls.duration.max}
                value={props.duration}
                onChange={(e) => props.onDurationChange(e.target.value)}
                title="Duration (seconds)"
                style={{ width: 72 }}
              />
            )
          ) : props.mode.includes("video") ? (
            <input
              className="field"
              type="number"
              min={1}
              max={20}
              value={props.duration}
              onChange={(e) => props.onDurationChange(e.target.value)}
              title="Duration (seconds)"
              style={{ width: 72 }}
            />
          ) : null}

          {props.controls?.quality ? (
            <select
              className="select"
              value={props.quality}
              onChange={(e) => props.onQualityChange(e.target.value)}
              title="Quality"
            >
              {props.controls.quality.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : null}

          {props.controls?.resolution ? (
            <select
              className="select"
              value={props.resolution}
              onChange={(e) => props.onResolutionChange(e.target.value)}
              title="Resolution"
            >
              {props.controls.resolution.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : null}

          {props.controls?.outputFormat ? (
            <select
              className="select"
              value={props.outputFormat}
              onChange={(e) => props.onOutputFormatChange(e.target.value)}
              title="Output format"
            >
              {props.controls.outputFormat.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : null}

          {props.controls?.background ? (
            <select
              className="select"
              value={props.background}
              onChange={(e) => props.onBackgroundChange(e.target.value)}
              title="Background"
            >
              {props.controls.background.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          ) : null}

          <select
            className="select"
            value={String(props.numGenerations)}
            onChange={(e) => props.onNumGenerationsChange(Number(e.target.value) || 1)}
            title="Oxen num_generations"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>

          {props.controls?.seed !== false ? (
            <input
              className="field"
              type="text"
              inputMode="numeric"
              placeholder="seed"
              value={props.seed}
              onChange={(e) => props.onSeedChange(e.target.value)}
              style={{ width: 88 }}
            />
          ) : null}

          {props.controls?.generateAudio ? (
            <label className="ghost-btn audio-toggle">
              <input
                type="checkbox"
                checked={props.generateAudio}
                onChange={(e) => props.onGenerateAudioChange(e.target.checked)}
              />
              Audio
            </label>
          ) : null}

          {showImage ? (
            <label className="ghost-btn attach">
              Image{imageMax > 1 ? `s (${imageMax})` : ""}
              <input
                type="file"
                accept="image/*"
                multiple={imageMax > 1}
                onChange={(e) => props.onPickFiles("image", e.target.files)}
              />
            </label>
          ) : null}

          {showVideo ? (
            <label className="ghost-btn attach">
              Video{videoMax > 1 ? `s (${videoMax})` : ""}
              <input
                type="file"
                accept="video/*"
                multiple={videoMax > 1}
                onChange={(e) => props.onPickFiles("video", e.target.files)}
              />
            </label>
          ) : null}

          {audioMax > 0 ? (
            <label className="ghost-btn attach">
              Audio
              <input
                type="file"
                accept="audio/*"
                multiple={audioMax > 1}
                onChange={(e) => props.onPickFiles("audio", e.target.files)}
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
        {slotRequired(props.controls, "image", props.mode) ? (
          <p className="composer-hint">This model needs at least one reference image.</p>
        ) : null}
        {slotRequired(props.controls, "video", props.mode) ? (
          <p className="composer-hint">This model needs a reference video.</p>
        ) : null}
      </div>
    </div>
  );
}
