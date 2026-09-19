import { useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import {
  ALL_MODES,
  MODE_LABELS,
  estimateGenerationCost,
  mentionToken,
  slotMax,
  slotRequired,
  type GenerationMode,
  type ModelControls,
  type OxenModel,
} from "../lib/api";
import {
  filterMentionItems,
  insertMentionToken,
  mentionAtCaret,
  tokenForItem,
} from "../lib/mentions";

type AttachItem = {
  name: string;
  preview: string;
  kind: "image" | "video" | "audio";
};

function ToolbarField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="toolbar-field">
      <span className="toolbar-field-label">{label}</span>
      {children}
    </label>
  );
}

function isFileDrag(event: DragEvent) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

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
  onAddFiles: (files: FileList | File[] | null) => void;
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
  const fileRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [caret, setCaret] = useState(0);
  const [mentionOpen, setMentionOpen] = useState(true);
  const [hotMention, setHotMention] = useState<number | null>(null);

  const preferredIds = new Set(props.preferred.map((model) => model.id));
  const preferredInMode = props.models.filter((model) => preferredIds.has(model.id));
  const rest = props.models.filter((model) => !preferredIds.has(model.id));
  const imageMax = Math.max(slotMax(props.controls, "image"), props.mode === "image-to-image" ? 1 : 0);
  const videoMax = Math.max(
    slotMax(props.controls, "video"),
    props.mode === "video-to-video" ? 1 : 0,
  );
  const audioMax = slotMax(props.controls, "audio");
  const showDropzone =
    imageMax > 0 ||
    videoMax > 0 ||
    audioMax > 0 ||
    props.mode === "image-to-image" ||
    props.mode === "reference-to-video" ||
    props.mode === "video-to-video";
  const aspectOptions =
    props.controls?.aspectRatios && props.controls.aspectRatios.length > 0
      ? props.controls.aspectRatios
      : props.mode.includes("video")
        ? ["16:9", "9:16", "1:1"]
        : ["1:1", "16:9", "9:16", "4:3", "3:4"];
  const selectedModel = props.models.find((item) => item.id === props.model);
  const cost = estimateGenerationCost({
    pricing: props.controls?.pricing ?? selectedModel?.pricing,
    numGenerations: props.numGenerations,
    duration: props.duration,
    generateAudio: props.generateAudio,
    resolution: props.resolution,
    quality: props.quality,
  });

  function controlPrice(kind: "resolution" | "quality", value: string) {
    switch (kind) {
      case "resolution":
        return estimateGenerationCost({
          pricing: props.controls?.pricing ?? selectedModel?.pricing,
          numGenerations: props.numGenerations,
          duration: props.duration,
          generateAudio: props.generateAudio,
          resolution: value,
          quality: props.quality,
        });
      case "quality":
        return estimateGenerationCost({
          pricing: props.controls?.pricing ?? selectedModel?.pricing,
          numGenerations: props.numGenerations,
          duration: props.duration,
          generateAudio: props.generateAudio,
          resolution: props.resolution,
          quality: value,
        });
      default: {
        const _exhaustive: never = kind;
        return _exhaustive;
      }
    }
  }

  function pricedOptionLabel(kind: "resolution" | "quality", values: string[], value: string) {
    const prices = values.map((item) => controlPrice(kind, item).amount);
    const distinct = new Set(prices.filter((amount) => amount != null));
    if (distinct.size < 2) return value;
    const option = controlPrice(kind, value);
    return option.amount != null ? `${value} · ${option.label}` : value;
  }
  const mention = mentionAtCaret(props.prompt, caret);
  const mentionItems = useMemo(() => {
    if (!mention || props.attachments.length === 0) return [];
    return filterMentionItems(mention.query, props.attachments);
  }, [mention, props.attachments]);
  const showMentions = Boolean(
    mentionOpen && props.controls?.mentions && mention && mentionItems.length > 0,
  );

  function placeCaret(nextCaret: number) {
    setCaret(nextCaret);
    const el = promptRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(nextCaret, nextCaret);
  }

  function insertMention(item: AttachItem, index: number) {
    const token = tokenForItem(props.attachments, item, index);
    const result = insertMentionToken(props.prompt, caret, token);
    if (!result) return;
    setMentionOpen(false);
    setHotMention(null);
    props.onPromptChange(result.next);
    placeCaret(result.caret);
  }

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

        <div
          className={`prompt-drop${dragging ? " dragging" : ""}`}
          onDragEnter={(event) => {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            dragDepth.current += 1;
            setDragging(true);
          }}
          onDragOver={(event) => {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!isFileDrag(event)) return;
            dragDepth.current -= 1;
            if (dragDepth.current <= 0) {
              dragDepth.current = 0;
              setDragging(false);
            }
          }}
          onDrop={(event) => {
            if (!isFileDrag(event)) return;
            event.preventDefault();
            dragDepth.current = 0;
            setDragging(false);
            props.onAddFiles(event.dataTransfer.files);
          }}
        >
          <textarea
            ref={promptRef}
            value={props.prompt}
            onChange={(e) => {
              setMentionOpen(true);
              props.onPromptChange(e.target.value);
              setCaret(e.target.selectionStart);
            }}
            onClick={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
            placeholder={
              showDropzone
                ? "Describe the shot… drop refs here, then @Image1 / @Video1 / @Audio1"
                : "Describe what to generate…"
            }
            onKeyDown={(e) => {
              if (e.key === "Escape" && showMentions) {
                e.preventDefault();
                setMentionOpen(false);
                setHotMention(null);
                return;
              }
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && props.canGenerate) {
                e.preventDefault();
                props.onGenerate();
              }
            }}
          />
          {dragging ? (
            <div className="prompt-drop-overlay" aria-hidden>
              Drop media to attach
            </div>
          ) : null}
          {showMentions ? (
            <div className="mention-menu" role="listbox">
              {mentionItems.map((item, index) => (
                <button
                  key={`${item.kind}-${item.name}-${index}`}
                  type="button"
                  className={`mention-option${hotMention === index ? " is-hot" : ""}`}
                  onPointerEnter={() => setHotMention(index)}
                  onPointerLeave={() => setHotMention((current) => (current === index ? null : current))}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insertMention(item, index);
                  }}
                >
                  {item.kind === "image" && item.preview ? (
                    <img src={item.preview} alt="" />
                  ) : (
                    <span className="pill">{item.kind.slice(0, 3).toUpperCase()}</span>
                  )}
                  <span>
                    {tokenForItem(props.attachments, item, index)} · {item.name}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {props.attachments.length > 0 ? (
          <div className="attach-preview">
            {props.attachments.map((item, index) => {
              const ofKind = props.attachments.filter((entry) => entry.kind === item.kind);
              const kindIndex = ofKind.indexOf(item);
              return (
                <div className="attach-chip" key={`${item.kind}-${item.name}-${index}`}>
                  {item.kind === "image" ? (
                    <img src={item.preview} alt="" />
                  ) : item.kind === "video" ? (
                    <video src={item.preview} muted />
                  ) : (
                    <span className="pill">AUD</span>
                  )}
                  <span>{mentionToken(item.kind, kindIndex)}</span>
                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={() => props.onClearAttachment(item.kind, kindIndex)}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
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
            aria-label="Model"
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
          <ToolbarField label="Favorite">
            <button
              type="button"
              className={`ghost-btn star-btn${props.isFavorite ? " active" : ""}`}
              onClick={props.onToggleFavorite}
              disabled={!props.model}
              aria-pressed={props.isFavorite}
              aria-label={props.isFavorite ? "Remove from Oxen favorites" : "Add to Oxen favorites"}
              title={props.isFavorite ? "Remove from Oxen favorites" : "Add to Oxen favorites"}
            >
              {props.isFavorite ? "★" : "☆"}
            </button>
          </ToolbarField>

          <ToolbarField label="Aspect">
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
          </ToolbarField>

          {props.controls?.duration ? (
            props.controls.duration.kind === "enum" ? (
              <ToolbarField label="Duration">
                <select
                  className="select"
                  value={props.duration}
                  onChange={(e) => props.onDurationChange(e.target.value)}
                >
                  {props.controls.duration.values.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </ToolbarField>
            ) : (
              <ToolbarField label="Duration">
                <input
                  className="field"
                  type="number"
                  min={props.controls.duration.min}
                  max={props.controls.duration.max}
                  value={props.duration}
                  onChange={(e) => props.onDurationChange(e.target.value)}
                  style={{ width: 72 }}
                />
              </ToolbarField>
            )
          ) : props.mode.includes("video") ? (
            <ToolbarField label="Duration">
              <input
                className="field"
                type="number"
                min={1}
                max={20}
                value={props.duration}
                onChange={(e) => props.onDurationChange(e.target.value)}
                style={{ width: 72 }}
              />
            </ToolbarField>
          ) : null}

          {props.controls?.quality ? (
            <ToolbarField label="Quality">
              <select
                className="select"
                value={props.quality}
                onChange={(e) => props.onQualityChange(e.target.value)}
              >
                {props.controls.quality.map((value) => (
                  <option key={value} value={value}>
                    {pricedOptionLabel("quality", props.controls?.quality ?? [], value)}
                  </option>
                ))}
              </select>
            </ToolbarField>
          ) : null}

          {props.controls?.resolution ? (
            <ToolbarField label="Resolution">
              <select
                className="select"
                value={props.resolution}
                onChange={(e) => props.onResolutionChange(e.target.value)}
              >
                {props.controls.resolution.map((value) => (
                  <option key={value} value={value}>
                    {pricedOptionLabel("resolution", props.controls?.resolution ?? [], value)}
                  </option>
                ))}
              </select>
            </ToolbarField>
          ) : null}

          {props.controls?.outputFormat ? (
            <ToolbarField label="Format">
              <select
                className="select"
                value={props.outputFormat}
                onChange={(e) => props.onOutputFormatChange(e.target.value)}
              >
                {props.controls.outputFormat.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </ToolbarField>
          ) : null}

          {props.controls?.background ? (
            <ToolbarField label="Background">
              <select
                className="select"
                value={props.background}
                onChange={(e) => props.onBackgroundChange(e.target.value)}
              >
                {props.controls.background.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </ToolbarField>
          ) : null}

          <ToolbarField label="Count">
            <select
              className="select"
              value={String(props.numGenerations)}
              onChange={(e) => props.onNumGenerationsChange(Number(e.target.value) || 1)}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </select>
          </ToolbarField>

          {props.controls?.seed !== false ? (
            <ToolbarField label="Seed">
              <input
                className="field"
                type="text"
                inputMode="numeric"
                placeholder="optional"
                value={props.seed}
                onChange={(e) => props.onSeedChange(e.target.value)}
                style={{ width: 88 }}
              />
            </ToolbarField>
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

          {showDropzone ? (
            <label className="ghost-btn attach">
              Add media
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*,audio/*"
                multiple
                onChange={(e) => {
                  props.onAddFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          ) : null}

          <button
            type="button"
            className="primary-btn"
            disabled={!props.canGenerate || props.busy}
            onClick={props.onGenerate}
            title="⌘↵"
            aria-label={
              props.busy
                ? "Queuing generation"
                : cost.amount != null
                  ? `Generate, estimated ${cost.label}, Command Enter`
                  : "Generate, Command Enter"
            }
          >
            {props.busy ? (
              "Queuing…"
            ) : (
              <>
                Generate
                {cost.amount != null ? <span className="primary-btn-cost">{cost.label}</span> : null}
                <span className="primary-btn-shortcut" aria-hidden>
                  <kbd>⌘</kbd>
                  <kbd>↵</kbd>
                </span>
              </>
            )}
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
