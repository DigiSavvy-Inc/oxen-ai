import { useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from "react";
import {
  ALL_MODES,
  MODE_LABELS,
  estimateGenerationCost,
  mentionToken,
  modeIsVideo,
  modelSupportsMode,
  slotRequired,
  type GenerationMode,
  type ModelControls,
  type OxenModel,
} from "../lib/api";
import {
  attachmentForMention,
  cycleHotIndex,
  deleteMentionToken,
  filterMentionItems,
  indexAfterInsertBefore,
  insertMentionToken,
  mentionAtCaret,
  promptHighlightParts,
  tokenForItem,
  type PromptMention,
} from "../lib/mentions";
import { shortenFileName } from "../lib/files";
import { mediaKindCap } from "../lib/library-refs";
import { aspectCatalog, aspectSelectOptions } from "../lib/params";
import { AudioAttachControl, ExpandMediaButton } from "./MediaLightbox";
import { ModelMenu } from "./ModelMenu";

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
  mode: GenerationMode | null;
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
  onReorderAttachments: (from: number, to: number) => void;
  busy: boolean;
  error: string | null;
  onGenerate: () => void;
  canGenerate: boolean;
};

export function Composer(props: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [caret, setCaret] = useState(0);
  const [mentionOpen, setMentionOpen] = useState(true);
  const [hotMention, setHotMention] = useState<number | null>(null);
  const [hoveredMention, setHoveredMention] = useState<{
    mention: PromptMention;
    item: AttachItem;
    left: number;
    top: number;
  } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropInsertBefore, setDropInsertBefore] = useState<number | null>(null);
  const [promptHeight, setPromptHeight] = useState(96);

  const imageMax = mediaKindCap(props.controls, props.mode, "image");
  const videoMax = mediaKindCap(props.controls, props.mode, "video");
  const audioMax = mediaKindCap(props.controls, props.mode, "audio");
  const audioCount = props.attachments.filter((item) => item.kind === "audio").length;
  const showDropzone =
    imageMax > 0 ||
    videoMax > 0 ||
    audioMax > 0 ||
    props.mode === "image-to-image" ||
    props.mode === "reference-to-video" ||
    props.mode === "video-to-video";
  const aspectOptions = aspectSelectOptions(
    aspectCatalog(props.controls, props.mode),
    props.aspectRatio,
  );
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
  const highlightParts = useMemo(() => promptHighlightParts(props.prompt), [props.prompt]);
  const activeMention =
    mentionItems.length === 0 ? 0 : Math.min(hotMention ?? 0, mentionItems.length - 1);

  function placeCaret(nextCaret: number) {
    setCaret(nextCaret);
    const el = promptRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(nextCaret, nextCaret);
  }

  function syncPromptScroll() {
    const prompt = promptRef.current;
    const highlight = highlightRef.current;
    if (!prompt || !highlight) return;
    highlight.scrollTop = prompt.scrollTop;
    highlight.scrollLeft = prompt.scrollLeft;
  }

  useLayoutEffect(() => {
    syncPromptScroll();
  }, [props.prompt, promptHeight]);

  function startPromptResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    const startY = event.clientY;
    const startHeight = promptHeight;
    handle.setPointerCapture(event.pointerId);
    function onMove(move: globalThis.PointerEvent) {
      const next = Math.round(startHeight + (move.clientY - startY));
      setPromptHeight(Math.min(420, Math.max(76, next)));
    }
    function onUp() {
      handle.releasePointerCapture(event.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  function insertMention(item: AttachItem) {
    const index = Math.max(0, props.attachments.indexOf(item));
    const token = tokenForItem(props.attachments, item, index);
    const result = insertMentionToken(props.prompt, caret, token);
    if (!result) return;
    setMentionOpen(false);
    setHotMention(null);
    props.onPromptChange(result.next);
    placeCaret(result.caret);
  }

  function openMentionHover(mention: PromptMention, el: HTMLElement) {
    const item = attachmentForMention(props.attachments, mention);
    if (!item || (item.kind !== "audio" && !item.preview)) {
      setHoveredMention(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    const left = rect.left + rect.width / 2;
    const top = rect.top;
    setHoveredMention((current) => {
      if (
        current &&
        current.mention.start === mention.start &&
        current.item === item &&
        current.left === left &&
        current.top === top
      ) {
        return current;
      }
      return { mention, item, left, top };
    });
  }

  function onFileDragEnter(event: DragEvent) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function onFileDragOver(event: DragEvent) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }

  function onFileDragLeave(event: DragEvent) {
    if (!isFileDrag(event)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  }

  function onFileDrop(event: DragEvent) {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    props.onAddFiles(event.dataTransfer.files);
  }

  function hoverMentionAtPoint(clientX: number, clientY: number) {
    const spans = highlightRef.current?.querySelectorAll<HTMLElement>("[data-mention-start]");
    if (!spans) {
      setHoveredMention(null);
      return;
    }
    for (const span of spans) {
      const rect = span.getBoundingClientRect();
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        continue;
      }
      const start = Number(span.dataset.mentionStart);
      const part = highlightParts.find(
        (entry) => entry.type === "mention" && entry.mention.start === start,
      );
      if (part?.type !== "mention") break;
      openMentionHover(part.mention, span);
      return;
    }
    setHoveredMention(null);
  }

  return (
    <div className="composer">
      <div
        className={`composer-inner${dragging ? " is-drop-target" : ""}`}
        onDragEnter={onFileDragEnter}
        onDragOver={onFileDragOver}
        onDragLeave={onFileDragLeave}
        onDrop={onFileDrop}
      >
        <div className="mode-row">
          {ALL_MODES.map((m) => {
            const unsupported = Boolean(selectedModel && !modelSupportsMode(selectedModel, m));
            return (
              <button
                key={m}
                type="button"
                className={`mode-chip${props.mode === m ? " active" : ""}${unsupported ? " is-ghost" : ""}`}
                aria-pressed={props.mode === m}
                title={
                  unsupported
                    ? `${MODE_LABELS[m]} isn’t available for this model — choosing it clears the model`
                    : MODE_LABELS[m]
                }
                onClick={() => props.onModeChange(m)}
              >
                {MODE_LABELS[m]}
              </button>
            );
          })}
        </div>

        <div className="prompt-drop">
          <div className="prompt-box">
            <div className="prompt-field" style={{ height: promptHeight }}>
            <div className="prompt-highlight" aria-hidden ref={highlightRef}>
              {highlightParts.map((part, index) => {
                if (part.type === "text") return <span key={`t-${index}`}>{part.value}</span>;
                const item = attachmentForMention(props.attachments, part.mention);
                return (
                  <span
                    key={`m-${part.mention.start}-${part.mention.token}`}
                    data-mention-start={part.mention.start}
                    className={`prompt-mention${item ? "" : " is-missing"}`}
                  >
                    {part.mention.token}
                  </span>
                );
              })}
              {props.prompt.endsWith("\n") ? "\n" : null}
            </div>
            <textarea
              ref={promptRef}
              value={props.prompt}
              onScroll={syncPromptScroll}
              onChange={(e) => {
                setMentionOpen(true);
                props.onPromptChange(e.target.value);
                setCaret(e.target.selectionStart);
              }}
              onClick={(e) => setCaret(e.currentTarget.selectionStart)}
              onKeyUp={(e) => setCaret(e.currentTarget.selectionStart)}
              onPointerMove={(e) => hoverMentionAtPoint(e.clientX, e.clientY)}
              onPointerLeave={() => setHoveredMention(null)}
              placeholder={
                showDropzone
                  ? "Describe the shot… drop refs here, then @Image1 / @Video1 / @Audio1"
                  : "Describe what to generate…"
              }
              onKeyDown={(e) => {
                if (
                  (e.key === "Backspace" || e.key === "Delete") &&
                  e.currentTarget.selectionStart === e.currentTarget.selectionEnd
                ) {
                  const result = deleteMentionToken(
                    props.prompt,
                    e.currentTarget.selectionStart ?? 0,
                    e.key === "Backspace" ? "backward" : "forward",
                  );
                  if (result) {
                    e.preventDefault();
                    props.onPromptChange(result.next);
                    placeCaret(result.caret);
                    return;
                  }
                }
                if (showMentions) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const delta = e.key === "ArrowDown" ? 1 : -1;
                    setHotMention((current) => cycleHotIndex(current, delta, mentionItems.length));
                    return;
                  }
                  if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
                    const item = mentionItems[activeMention];
                    if (item) {
                      e.preventDefault();
                      insertMention(item);
                      return;
                    }
                  }
                  if (e.key === "Tab") {
                    const item = mentionItems[activeMention];
                    if (item) {
                      e.preventDefault();
                      insertMention(item);
                      return;
                    }
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setMentionOpen(false);
                    setHotMention(null);
                    return;
                  }
                }
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && props.canGenerate) {
                  e.preventDefault();
                  props.onGenerate();
                }
              }}
            />
          </div>
          <div
            className="prompt-resize"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize prompt"
            onPointerDown={startPromptResize}
          >
            <span className="prompt-resize-mark" aria-hidden>
              <span className="prompt-resize-arrow is-up" />
              <span className="prompt-resize-line" />
              <span className="prompt-resize-arrow is-down" />
            </span>
          </div>
          </div>
          {showMentions ? (
            <div className="mention-menu" role="listbox">
              {mentionItems.map((item, index) => (
                <button
                  key={`${item.kind}-${item.name}-${index}`}
                  type="button"
                  className={`mention-option${activeMention === index ? " is-hot" : ""}`}
                  onPointerEnter={() => setHotMention(index)}
                  onPointerLeave={() => setHotMention((current) => (current === index ? null : current))}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    insertMention(item);
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
          <div
            className="attach-preview"
            onDragOver={(event) => {
              if (isFileDrag(event) || dragIndex == null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              if (isFileDrag(event)) return;
              event.preventDefault();
              const from = Number(event.dataTransfer.getData("text/plain"));
              const insertBefore = dropInsertBefore ?? props.attachments.length;
              setDragIndex(null);
              setDropInsertBefore(null);
              if (!Number.isInteger(from)) return;
              props.onReorderAttachments(from, indexAfterInsertBefore(from, insertBefore));
            }}
          >
            {props.attachments.map((item, index) => {
              const ofKind = props.attachments.filter((entry) => entry.kind === item.kind);
              const kindIndex = ofKind.indexOf(item);
              const token = mentionToken(item.kind, kindIndex);
              const showSlot =
                dragIndex != null &&
                dropInsertBefore === index &&
                dropInsertBefore !== dragIndex &&
                dropInsertBefore !== dragIndex + 1;
              return (
                <div key={`${item.kind}-${item.name}-${index}`} className="attach-slot">
                  {showSlot ? (
                    <div className="attach-drop-slot" aria-hidden>
                      Drop
                    </div>
                  ) : null}
                  <div
                    className={`attach-chip${dragIndex === index ? " is-dragging" : ""}`}
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
                      event.dataTransfer.dropEffect = "move";
                      const rect = event.currentTarget.getBoundingClientRect();
                      const insertBefore = event.clientX < rect.left + rect.width / 2 ? index : index + 1;
                      if (dropInsertBefore !== insertBefore) setDropInsertBefore(insertBefore);
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setDropInsertBefore(null);
                    }}
                  >
                    <span className="attach-grip" aria-hidden>
                      ⋮⋮
                    </span>
                    <div className="attach-thumb">
                      {item.kind === "image" ? (
                        <img src={item.preview} alt="" draggable={false} />
                      ) : item.kind === "video" ? (
                        <video src={item.preview} muted draggable={false} />
                      ) : (
                        <AudioAttachControl src={item.preview} name={item.name} token={token} />
                      )}
                      {item.kind !== "audio" && item.preview ? (
                        <ExpandMediaButton
                          label={`Preview ${token}`}
                          preview={item.preview}
                          kind={item.kind === "video" ? "video" : "image"}
                        />
                      ) : null}
                    </div>
                    <span className="attach-chip-copy">
                      <span className="attach-chip-token">{token}</span>
                      <span className="attach-chip-name">{shortenFileName(item.name)}</span>
                      <span className="attach-name-tip" role="tooltip">
                        {item.name}
                      </span>
                    </span>
                    <button
                      className="ghost-btn"
                      type="button"
                      onClick={() => props.onClearAttachment(item.kind, kindIndex)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
            {dragIndex != null &&
            dropInsertBefore === props.attachments.length &&
            dragIndex !== props.attachments.length - 1 ? (
              <div className="attach-drop-slot" aria-hidden>
                Drop
              </div>
            ) : null}
            {audioMax > 1 ? (
              <span className="attach-count">
                Audio {audioCount}/{audioMax}
              </span>
            ) : null}
          </div>
        ) : null}

        {props.error ? <div className="error-banner">{props.error}</div> : null}

        <div className="composer-toolbar">
          <ModelMenu
            models={props.models}
            preferred={props.preferred}
            value={props.model}
            query={props.modelQuery}
            onQueryChange={props.onModelQueryChange}
            onChange={props.onModelChange}
          />
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
              value={props.aspectRatio}
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
          ) : props.mode && modeIsVideo(props.mode) ? (
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
        {dragging ? (
          <div className="prompt-drop-overlay" aria-hidden>
            Drop media to attach
          </div>
        ) : null}
      </div>
      {hoveredMention ? (
        <div
          className="mention-hover"
          style={{ left: hoveredMention.left, top: hoveredMention.top }}
          role="tooltip"
        >
          {hoveredMention.item.kind === "audio" ? (
            <span className="pill">AUD</span>
          ) : hoveredMention.item.kind === "video" ? (
            <video src={hoveredMention.item.preview} muted playsInline />
          ) : (
            <img src={hoveredMention.item.preview} alt="" />
          )}
          <span>{hoveredMention.item.name}</span>
          <span>{hoveredMention.mention.token}</span>
        </div>
      ) : null}
    </div>
  );
}
