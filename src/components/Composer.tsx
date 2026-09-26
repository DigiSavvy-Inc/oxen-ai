import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  ALL_MODES,
  MODE_LABELS,
  estimateGenerationCost,
  modeIsVideo,
  modelSupportsMode,
  slotRequired,
  type GenerationMode,
  type ModelControls,
  type OxenModel,
  type SavedPrompt,
} from "../lib/api";
import {
  attachmentForMention,
  cycleHotIndex,
  deleteMentionToken,
  filterMentionItems,
  indexAfterInsertBefore,
  insertMentionToken,
  mentionAtCaret,
  mentionOrdered,
  promptHighlightParts,
  tokenForItem,
  type PromptMention,
} from "../lib/mentions";
import { shortenFileName } from "../lib/files";
import { mediaKindCap } from "../lib/library-refs";
import { aspectCatalog, aspectSelectOptions } from "../lib/params";
import type { GallerySummary } from "../lib/api";
import { AudioAttachControl, ExpandMediaButton } from "./MediaLightbox";
import { GalleryDrawer, type GalleryDraftItem } from "./GalleryDrawer";
import { Loader } from "./Loader";
import { ModelMenu } from "./ModelMenu";

type AttachItem = {
  name: string;
  preview: string;
  kind: "image" | "video" | "audio";
  role?: "character" | "scene";
};

function faceFieldForKind(kind: AttachItem["kind"]): "input_face_images" | "input_face_videos" | null {
  switch (kind) {
    case "image":
      return "input_face_images";
    case "video":
      return "input_face_videos";
    case "audio":
      return null;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

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

function savedPromptLabel(item: Pick<SavedPrompt, "name" | "body">): string {
  const name = item.name.trim();
  if (name) return name;
  const line = item.body.trim().split("\n")[0] ?? "";
  if (!line) return "Untitled";
  return line.length > 48 ? `${line.slice(0, 48)}…` : line;
}

export type PromptField = {
  element: HTMLTextAreaElement | null;
  place: (caret: number, prompt: string) => void;
};

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
  onPromptField?: (field: PromptField | null) => void;
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
  showLastFrame?: boolean;
  getLastFrame?: boolean;
  onGetLastFrameChange?: (value: boolean) => void;
  savedPrompts?: SavedPrompt[];
  onSavePrompt?: (name: string, body: string) => Promise<void> | void;
  onUpdateSavedPrompt?: (id: string, name: string, body: string) => Promise<void> | void;
  onDeleteSavedPrompt?: (id: string) => Promise<void> | void;
  galleryName?: string;
  onGalleryNameChange?: (value: string) => void;
  galleryItems?: GalleryDraftItem[];
  gallerySummaries?: GallerySummary[];
  gallerySaving?: boolean;
  galleryAdding?: boolean;
  galleryStatus?: string | null;
  onGalleryAddFiles?: (files: FileList | File[] | null) => void;
  onGalleryRemove?: (index: number) => void;
  onGalleryReorder?: (from: number, to: number) => void;
  onGallerySave?: () => Promise<void> | void;
  onGalleryNew?: () => void;
  onGalleryLoad?: (id: string) => Promise<void> | void;
  onGalleryAttach?: () => string[];
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
  onToggleAttachmentRole: (index: number) => void;
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
  const [savedOpen, setSavedOpen] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState<{ id: string | null; name: string; body: string } | null>(
    null,
  );
  const [galleryForMode, setGalleryForMode] = useState<GenerationMode | null>(null);
  const [gallerySkipped, setGallerySkipped] = useState<string[]>([]);
  const savedMenuRef = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<{ caret: number; prompt: string } | null>(null);

  const imageMax = mediaKindCap(props.controls, props.mode, "image");
  const videoMax = mediaKindCap(props.controls, props.mode, "video");
  const audioMax = mediaKindCap(props.controls, props.mode, "audio");
  const audioCount = props.attachments.filter((item) => item.kind === "audio").length;
  const galleryAvailable = Boolean(props.mode && modeIsVideo(props.mode));
  const galleryOpen = galleryAvailable && galleryForMode === props.mode;
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
  const faceFirst = Boolean(
    props.controls?.slots.some(
      (slot) => slot.field === "input_face_images" || slot.field === "input_face_videos",
    ),
  );
  const mentionSource = useMemo(
    () => mentionOrdered(props.attachments, faceFirst),
    [props.attachments, faceFirst],
  );
  const mention = mentionAtCaret(props.prompt, caret);
  const mentionItems = useMemo(() => {
    if (!mention || mentionSource.length === 0) return [];
    return filterMentionItems(mention.query, mentionSource);
  }, [mention, mentionSource]);
  const showMentions = Boolean(
    mentionOpen && props.controls?.mentions && mention && mentionItems.length > 0,
  );
  const highlightParts = useMemo(() => promptHighlightParts(props.prompt), [props.prompt]);
  const activeMention =
    mentionItems.length === 0 ? 0 : Math.min(hotMention ?? 0, mentionItems.length - 1);

  function placeCaret(nextCaret: number, prompt: string) {
    pendingCaret.current = { caret: nextCaret, prompt };
    setCaret(nextCaret);
  }

  function loadSavedPrompt(body: string) {
    setMentionOpen(false);
    setSavedOpen(false);
    setPromptDraft(null);
    props.onPromptChange(body);
    placeCaret(body.length, body);
  }

  function openNewPromptDraft() {
    if (!props.prompt.trim() || !props.onSavePrompt) return;
    setPromptDraft({ id: null, name: "", body: props.prompt });
    setSavedOpen(true);
  }

  async function commitPromptDraft() {
    if (!promptDraft || savingPrompt) return;
    if (promptDraft.id ? !props.onUpdateSavedPrompt : !props.onSavePrompt) return;
    setSavingPrompt(true);
    try {
      if (promptDraft.id) {
        await props.onUpdateSavedPrompt?.(promptDraft.id, promptDraft.name, promptDraft.body);
      } else {
        await props.onSavePrompt?.(promptDraft.name, promptDraft.body);
      }
      setPromptDraft(null);
      setSavedOpen(true);
    } catch {
      /* App surfaces the error */
    } finally {
      setSavingPrompt(false);
    }
  }

  useEffect(() => {
    if (!savedOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setSavedOpen(false);
    }
    function onPointer(event: globalThis.PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (savedMenuRef.current?.contains(target)) return;
      setSavedOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [savedOpen]);

  useLayoutEffect(() => {
    props.onPromptField?.({
      element: promptRef.current,
      place: placeCaret,
    });
    const pending = pendingCaret.current;
    const el = promptRef.current;
    if (!pending || !el || el.value !== pending.prompt) return;
    pendingCaret.current = null;
    const next = Math.max(0, Math.min(pending.caret, el.value.length));
    el.focus();
    el.setSelectionRange(next, next);
  });

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
    const token = tokenForItem(mentionSource, item, index);
    const result = insertMentionToken(props.prompt, caret, token);
    if (!result) return;
    setMentionOpen(false);
    setHotMention(null);
    props.onPromptChange(result.next);
    placeCaret(result.caret, result.next);
  }

  function openMentionHover(mention: PromptMention, el: HTMLElement) {
    const item = attachmentForMention(mentionSource, mention);
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

  function attachGallery() {
    const skipped = props.onGalleryAttach?.() ?? [];
    setGallerySkipped(skipped);
  }

  return (
    <div className="composer">
      <div className="composer-layout">
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
          {galleryAvailable ? (
            <button
              type="button"
              className={`gallery-toggle${galleryOpen ? " active" : ""}`}
              aria-expanded={galleryOpen}
              aria-controls="gallery-drawer"
              onClick={() =>
                setGalleryForMode((current) => (current === props.mode ? null : props.mode))
              }
            >
              Gallery
            </button>
          ) : null}
        </div>

        <div className="prompt-drop">
          <div className="prompt-box">
            <div className="prompt-field" style={{ height: promptHeight }}>
            <div className="prompt-highlight" aria-hidden ref={highlightRef}>
              {highlightParts.map((part, index) => {
                if (part.type === "text") return <span key={`t-${index}`}>{part.value}</span>;
                const item = attachmentForMention(mentionSource, part.mention);
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
                    placeCaret(result.caret, result.next);
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
          <div className="prompt-actions" ref={savedMenuRef}>
            <button
              type="button"
              className="prompt-action"
              disabled={!props.prompt.trim() || savingPrompt || !props.onSavePrompt}
              onClick={openNewPromptDraft}
            >
              Save prompt
            </button>
            <div className="saved-prompts">
              <button
                type="button"
                className="prompt-action"
                aria-expanded={savedOpen}
                aria-haspopup="listbox"
                onClick={() => setSavedOpen((open) => !open)}
              >
                Saved
              </button>
              {savedOpen ? (
                <div className="saved-prompts-menu" role="listbox" aria-label="Saved prompts">
                  {promptDraft ? (
                    <form
                      className="saved-prompt-editor"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void commitPromptDraft();
                      }}
                    >
                      <input
                        className="field"
                        value={promptDraft.name}
                        placeholder="Name"
                        aria-label="Prompt name"
                        onChange={(event) =>
                          setPromptDraft((draft) =>
                            draft ? { ...draft, name: event.target.value } : draft,
                          )
                        }
                      />
                      <textarea
                        className="field"
                        value={promptDraft.body}
                        aria-label="Prompt text"
                        rows={3}
                        onChange={(event) =>
                          setPromptDraft((draft) =>
                            draft ? { ...draft, body: event.target.value } : draft,
                          )
                        }
                      />
                      <button
                        type="submit"
                        className="prompt-action"
                        disabled={
                          savingPrompt || !promptDraft.name.trim() || !promptDraft.body.trim()
                        }
                      >
                        {savingPrompt ? "Saving…" : promptDraft.id ? "Save changes" : "Save"}
                      </button>
                    </form>
                  ) : null}
                  {(props.savedPrompts ?? []).length === 0 ? (
                    <p className="saved-prompts-empty">No saved prompts yet</p>
                  ) : (
                    (props.savedPrompts ?? []).map((item) => (
                      <div key={item.id} className="saved-prompt-row">
                        <button
                          type="button"
                          className="saved-prompt-load"
                          role="option"
                          title={item.body}
                          onClick={() => loadSavedPrompt(item.body)}
                        >
                          {savedPromptLabel(item)}
                        </button>
                        <button
                          type="button"
                          className="saved-prompt-edit"
                          aria-label={`Edit ${savedPromptLabel(item)}`}
                          onClick={() => {
                            setPromptDraft({ id: item.id, name: item.name, body: item.body });
                            setSavedOpen(true);
                          }}
                        >
                          Edit
                        </button>
                        {props.onDeleteSavedPrompt ? (
                          <button
                            type="button"
                            className="saved-prompt-delete"
                            aria-label="Delete saved prompt"
                            onClick={() => void props.onDeleteSavedPrompt?.(item.id)}
                          >
                            ×
                          </button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
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
                    {tokenForItem(mentionSource, item, index)} · {item.name}
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
              const token = tokenForItem(mentionSource, item, index);
              const roleField = faceFieldForKind(item.kind);
              const showRole = Boolean(
                roleField && props.controls?.slots.some((slot) => slot.field === roleField),
              );
              const isScene = item.role === "scene";
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
                    {showRole ? (
                      <button
                        className={`attach-role${isScene ? " is-scene" : ""}`}
                        type="button"
                        aria-pressed={!isScene}
                        title={
                          isScene
                            ? "Scene reference. Seedance sends this as a regular image or video. Click to mark it as a character."
                            : "Character reference. Seedance sends faces and people on the face input so content filters do not block them. Click to mark it as a scene."
                        }
                        onClick={() => props.onToggleAttachmentRole(index)}
                      >
                        {isScene ? "Scene" : "Character"}
                      </button>
                    ) : null}
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

          {props.showLastFrame ? (
            <label className="ghost-btn audio-toggle">
              <input
                type="checkbox"
                checked={props.getLastFrame === true}
                onChange={(e) => props.onGetLastFrameChange?.(e.target.checked)}
              />
              Get last frame
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
              <Loader size="sm" label="Queuing…" />
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
      {galleryAvailable && galleryOpen ? (
        <GalleryDrawer
          name={props.galleryName ?? ""}
          onNameChange={(value) => props.onGalleryNameChange?.(value)}
          items={props.galleryItems ?? []}
          summaries={props.gallerySummaries ?? []}
          saving={props.gallerySaving === true}
          adding={props.galleryAdding === true}
          status={props.galleryStatus ?? null}
          skipped={gallerySkipped}
          onAddFiles={(files) => props.onGalleryAddFiles?.(files)}
          onRemove={(index) => props.onGalleryRemove?.(index)}
          onReorder={(from, to) => props.onGalleryReorder?.(from, to)}
          onSave={() => void props.onGallerySave?.()}
          onNew={() => {
            setGallerySkipped([]);
            props.onGalleryNew?.();
          }}
          onLoad={(id) => void props.onGalleryLoad?.(id)}
          onAttach={attachGallery}
          onClose={() => setGalleryForMode(null)}
        />
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
