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
import { createPortal } from "react-dom";
import {
  ALL_MODES,
  MODE_LABELS,
  estimateGenerationCost,
  modeHasReferenceGallery,
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
  deleteMentionToken,
  filterMentionItems,
  indexAfterInsertBefore,
  insertMentionToken,
  mentionAtCaret,
  mentionKeyAction,
  mentionOrdered,
  placeMentionPreview,
  stepMentionHot,
  promptHighlightParts,
  tokenForItem,
  type PromptMention,
} from "../lib/mentions";
import { shortenFileName } from "../lib/files";
import type { ModelUseCounts } from "../lib/model-uses";
import { GALLERY_ITEM_DRAG_TYPE, galleryItemsForDrop, isGalleryItemDrag } from "../lib/gallery-attach";
import { acceptedMediaKinds, fileAcceptValue, mediaKindPhrase, attachKindCap } from "../lib/library-refs";
import { aspectCatalog, aspectSelectOptions } from "../lib/params";
import {
  durationFieldValue,
  durationToSend,
  nearestDurationValue,
  numericControlValue,
  snapNumericControl,
  type DurationControl,
} from "../../worker/schema";
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

function RangeField({
  label,
  control,
  value,
  onChange,
}: {
  label: string;
  control: DurationControl | null;
  value: string;
  onChange?: (value: string) => void;
}) {
  if (!control || control.kind !== "int" || !onChange) return null;
  return (
    <ToolbarField label={label}>
      <input
        className="field"
        type="number"
        inputMode="decimal"
        aria-label={label}
        min={control.min}
        max={control.max}
        step={control.step ?? 1}
        value={value}
        onChange={(event) => onChange(numericControlValue(event.target.value, control))}
        onBlur={() => {
          const next = snapNumericControl(value, control);
          if (next !== value) onChange(next);
        }}
        style={{ width: 72 }}
      />
    </ToolbarField>
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
  modelUses?: ModelUseCounts;
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
  draft?: boolean;
  onDraftChange?: (value: boolean) => void;
  safetyTolerance?: string;
  onSafetyToleranceChange?: (value: string) => void;
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
  onGallerySave?: () => Promise<boolean | void> | boolean | void;
  onGalleryNew?: () => void;
  onGalleryLoad?: (id: string) => Promise<void> | void;
  onGalleryAttach?: (items?: GalleryDraftItem[], caret?: number | null) => string[];
  quality: string;
  onQualityChange: (value: string) => void;
  resolution: string;
  onResolutionChange: (value: string) => void;
  outputFormat: string;
  onOutputFormatChange: (value: string) => void;
  sampleRate?: string;
  onSampleRateChange?: (value: string) => void;
  speed?: string;
  onSpeedChange?: (value: string) => void;
  volume?: string;
  onVolumeChange?: (value: string) => void;
  pitch?: string;
  onPitchChange?: (value: string) => void;
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

const PROMPT_HEIGHT_BASE = 96;
const PROMPT_HEIGHT_MIN = 76;
const PROMPT_HEIGHT_MAX = 420;

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
  } | null>(null);
  const [hoverPos, setHoverPos] = useState<{ left: number; top: number } | null>(null);
  const [hoverLayout, setHoverLayout] = useState(0);
  const hoverAnchorRef = useRef<HTMLElement | null>(null);
  const hoverTipRef = useRef<HTMLDivElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropInsertBefore, setDropInsertBefore] = useState<number | null>(null);
  const [promptHeight, setPromptHeight] = useState(PROMPT_HEIGHT_BASE);
  const [promptMenu, setPromptMenu] = useState<"save" | "load" | null>(null);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptDraft, setPromptDraft] = useState<{ id: string | null; name: string; body: string } | null>(
    null,
  );
  const [savedMark, setSavedMark] = useState<string | null>(null);
  const [galleryForMode, setGalleryForMode] = useState<GenerationMode | null>(null);
  const [gallerySkipped, setGallerySkipped] = useState<string[]>([]);
  const savedMenuRef = useRef<HTMLDivElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<{ caret: number; prompt: string } | null>(null);
  const promptCaretReady = useRef(false);

  const selectedModel = props.models.find((item) => item.id === props.model);
  const imageMax = attachKindCap(props.controls, props.mode, "image", selectedModel);
  const videoMax = attachKindCap(props.controls, props.mode, "video", selectedModel);
  const audioMax = attachKindCap(props.controls, props.mode, "audio", selectedModel);
  const acceptedKinds = acceptedMediaKinds(props.controls, props.mode, selectedModel);
  const fileAccept = fileAcceptValue(acceptedKinds);
  const dropPhrase = mediaKindPhrase(acceptedKinds);
  const audioCount = props.attachments.filter((item) => item.kind === "audio").length;
  const galleryAvailable = modeHasReferenceGallery(props.mode);
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
  const showAspect =
    props.mode === "text-to-audio"
      ? Boolean(props.controls?.aspectRatios && props.controls.aspectRatios.length > 0)
      : aspectOptions.length > 0;
  const durationControl =
    props.mode && modeIsVideo(props.mode) ? (props.controls?.duration ?? null) : null;
  const billableDuration = durationControl ? durationToSend(props.duration, durationControl) : undefined;
  const cost = estimateGenerationCost({
    pricing: props.controls?.pricing ?? selectedModel?.pricing,
    numGenerations: props.numGenerations,
    duration: billableDuration,
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
          duration: billableDuration,
          generateAudio: props.generateAudio,
          resolution: value,
          quality: props.quality,
        });
      case "quality":
        return estimateGenerationCost({
          pricing: props.controls?.pricing ?? selectedModel?.pricing,
          numGenerations: props.numGenerations,
          duration: billableDuration,
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

  useLayoutEffect(() => {
    if (!showMentions) return;
    const menu = mentionMenuRef.current;
    const option = menu?.querySelectorAll<HTMLElement>(".mention-option")[activeMention];
    if (!menu || !option) return;
    const top = option.offsetTop;
    const bottom = top + option.offsetHeight;
    if (top < menu.scrollTop) menu.scrollTop = top;
    else if (bottom > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = bottom - menu.clientHeight;
    }
  }, [showMentions, activeMention, mentionItems]);

  function placeCaret(nextCaret: number, prompt: string) {
    promptCaretReady.current = true;
    pendingCaret.current = { caret: nextCaret, prompt };
    setCaret(nextCaret);
  }

  const hasSavedPrompts = (props.savedPrompts ?? []).length > 0;
  if (savedMark !== null && props.prompt !== savedMark) setSavedMark(null);
  if (!hasSavedPrompts && promptMenu === "load") {
    setPromptMenu(null);
    setPromptDraft(null);
  }
  const showSaved = savedMark !== null && props.prompt === savedMark;

  function loadSavedPrompt(body: string) {
    setMentionOpen(false);
    setPromptMenu(null);
    setPromptDraft(null);
    props.onPromptChange(body);
    placeCaret(body.length, body);
  }

  function openNewPromptDraft() {
    if (!props.prompt.trim() || !props.onSavePrompt) return;
    setPromptDraft({ id: null, name: "", body: props.prompt });
    setPromptMenu("save");
  }

  function openLoadMenu() {
    setPromptDraft(null);
    setPromptMenu((menu) => (menu === "load" ? null : "load"));
  }

  async function commitPromptDraft() {
    if (!promptDraft || savingPrompt) return;
    if (promptDraft.id ? !props.onUpdateSavedPrompt : !props.onSavePrompt) return;
    const draft = promptDraft;
    setSavingPrompt(true);
    try {
      if (draft.id) {
        await props.onUpdateSavedPrompt?.(draft.id, draft.name, draft.body);
        setPromptDraft(null);
        setPromptMenu("load");
      } else {
        await props.onSavePrompt?.(draft.name, draft.body);
        setPromptDraft(null);
        setPromptMenu(null);
        setSavedMark(draft.body === props.prompt ? draft.body : null);
      }
    } catch {
      /* App surfaces the error */
    } finally {
      setSavingPrompt(false);
    }
  }

  useEffect(() => {
    if (!promptMenu) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPromptMenu(null);
        setPromptDraft(null);
      }
    }
    function onPointer(event: globalThis.PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (savedMenuRef.current?.contains(target)) return;
      setPromptMenu(null);
      setPromptDraft(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [promptMenu]);

  function promptEditor(submitLabel: string) {
    if (!promptDraft) return null;
    return (
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
            setPromptDraft((draft) => (draft ? { ...draft, name: event.target.value } : draft))
          }
        />
        <textarea
          className="field"
          value={promptDraft.body}
          aria-label="Prompt text"
          rows={3}
          onChange={(event) =>
            setPromptDraft((draft) => (draft ? { ...draft, body: event.target.value } : draft))
          }
        />
        <button
          type="submit"
          className="prompt-action"
          disabled={savingPrompt || !promptDraft.name.trim() || !promptDraft.body.trim()}
        >
          {savingPrompt ? "Saving…" : submitLabel}
        </button>
      </form>
    );
  }

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

  useLayoutEffect(() => {
    const main = promptRef.current?.closest(".main");
    if (!(main instanceof HTMLElement)) return;
    const extra = Math.max(0, promptHeight - PROMPT_HEIGHT_BASE);
    if (extra > 0) main.style.setProperty("--composer-grow", `${extra}px`);
    else main.style.removeProperty("--composer-grow");
    return () => {
      main.style.removeProperty("--composer-grow");
    };
  }, [promptHeight]);

  function startPromptResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    const startY = event.clientY;
    const startHeight = promptHeight;
    handle.setPointerCapture(event.pointerId);
    function onMove(move: globalThis.PointerEvent) {
      const next = Math.round(startHeight + (move.clientY - startY));
      setPromptHeight(Math.min(PROMPT_HEIGHT_MAX, Math.max(PROMPT_HEIGHT_MIN, next)));
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

  function clearMentionHover() {
    hoverAnchorRef.current = null;
    setHoveredMention(null);
    setHoverPos(null);
  }

  function openMentionHover(mention: PromptMention, el: HTMLElement) {
    const item = attachmentForMention(mentionSource, mention);
    if (!item || (item.kind !== "audio" && !item.preview)) {
      clearMentionHover();
      return;
    }
    hoverAnchorRef.current = el;
    setHoveredMention((current) => {
      if (current && current.mention.start === mention.start && current.item === item) return current;
      return { mention, item };
    });
  }

  useLayoutEffect(() => {
    const anchor = hoverAnchorRef.current;
    const tip = hoverTipRef.current;
    if (!hoveredMention || !anchor || !tip) return;
    const next = placeMentionPreview(
      anchor.getBoundingClientRect(),
      { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setHoverPos((current) =>
      current && current.left === next.left && current.top === next.top ? current : next,
    );
  }, [hoveredMention, hoverLayout]);

  useEffect(() => {
    if (!hoveredMention) return;
    const bump = () => setHoverLayout((n) => n + 1);
    window.addEventListener("resize", bump);
    window.addEventListener("scroll", bump, true);
    return () => {
      window.removeEventListener("resize", bump);
      window.removeEventListener("scroll", bump, true);
    };
  }, [hoveredMention]);

  function promptDragKind(event: DragEvent): "file" | "gallery" | null {
    if (isFileDrag(event)) return "file";
    if (isGalleryItemDrag(event.dataTransfer.types)) return "gallery";
    return null;
  }

  function galleryDropCaret(): number | null {
    const el = promptRef.current;
    if (el && document.activeElement === el) return el.selectionStart;
    if (promptCaretReady.current) return caret;
    return null;
  }

  function onFileDragEnter(event: DragEvent) {
    if (!promptDragKind(event)) return;
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  }

  function onFileDragOver(event: DragEvent) {
    if (!promptDragKind(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }

  function onFileDragLeave(event: DragEvent) {
    if (!promptDragKind(event)) return;
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragging(false);
    }
  }

  function onFileDrop(event: DragEvent) {
    const kind = promptDragKind(event);
    if (!kind) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (kind === "gallery") {
      const id = event.dataTransfer.getData(GALLERY_ITEM_DRAG_TYPE);
      const picked = galleryItemsForDrop(props.galleryItems ?? [], id);
      if (picked.length !== 1) return;
      setGallerySkipped(props.onGalleryAttach?.(picked, galleryDropCaret()) ?? []);
      return;
    }
    props.onAddFiles(event.dataTransfer.files);
  }

  function hoverMentionAtPoint(clientX: number, clientY: number) {
    const spans = highlightRef.current?.querySelectorAll<HTMLElement>("[data-mention-start]");
    if (!spans) {
      clearMentionHover();
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
    clearMentionHover();
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
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showMentions}
              aria-controls={showMentions ? "mention-menu" : undefined}
              aria-activedescendant={showMentions ? `mention-option-${activeMention}` : undefined}
              onScroll={syncPromptScroll}
              onChange={(e) => {
                setMentionOpen(true);
                props.onPromptChange(e.target.value);
                promptCaretReady.current = true;
                setCaret(e.target.selectionStart);
              }}
              onFocus={(e) => {
                promptCaretReady.current = true;
                setCaret(e.currentTarget.selectionStart);
              }}
              onClick={(e) => {
                promptCaretReady.current = true;
                setCaret(e.currentTarget.selectionStart);
              }}
              onKeyUp={(e) => {
                promptCaretReady.current = true;
                setCaret(e.currentTarget.selectionStart);
              }}
              onPointerMove={(e) => hoverMentionAtPoint(e.clientX, e.clientY)}
              onPointerLeave={() => clearMentionHover()}
              placeholder={
                showDropzone
                  ? props.controls?.mentions
                    ? "Describe the shot… drop refs here, then @Image1 / @Video1 / @Audio1"
                    : props.mode === "video-to-video"
                      ? "Describe the shot… drop a clip to continue"
                      : "Describe the shot… drop keyframes here"
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
                  const action = mentionKeyAction(e.key, {
                    shiftKey: e.shiftKey,
                    metaKey: e.metaKey,
                    ctrlKey: e.ctrlKey,
                  });
                  if (action) {
                    switch (action.type) {
                      case "move":
                        e.preventDefault();
                        setHotMention((current) =>
                          stepMentionHot(current, action.delta, mentionItems.length),
                        );
                        return;
                      case "confirm": {
                        const item = mentionItems[activeMention];
                        if (item) {
                          e.preventDefault();
                          insertMention(item);
                        }
                        return;
                      }
                      case "close":
                        e.preventDefault();
                        setMentionOpen(false);
                        setHotMention(null);
                        return;
                      default: {
                        const _exhaustive: never = action;
                        return _exhaustive;
                      }
                    }
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
            <div className="saved-prompts">
              <button
                type="button"
                className="prompt-action"
                disabled={!props.prompt.trim() || savingPrompt || !props.onSavePrompt}
                onClick={openNewPromptDraft}
              >
                Save prompt
              </button>
              {promptMenu === "save" && promptDraft && !promptDraft.id ? (
                <div className="saved-prompts-menu" role="dialog" aria-label="Save prompt">
                  {promptEditor("Save")}
                </div>
              ) : null}
            </div>
            {showSaved ? (
              <span className="prompt-saved" aria-live="polite">
                Saved
              </span>
            ) : null}
            {hasSavedPrompts ? (
              <div className="saved-prompts">
                <button
                  type="button"
                  className="prompt-action"
                  aria-expanded={promptMenu === "load"}
                  aria-haspopup="listbox"
                  onClick={openLoadMenu}
                >
                  Load prompt
                </button>
                {promptMenu === "load" ? (
                  <div className="saved-prompts-menu" role="listbox" aria-label="Saved prompts">
                    {promptDraft?.id ? promptEditor("Save changes") : null}
                    {(props.savedPrompts ?? []).map((item) => (
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
                            setPromptMenu("load");
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
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
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
            <div className="mention-menu" id="mention-menu" role="listbox" ref={mentionMenuRef}>
              {mentionItems.map((item, index) => (
                <button
                  key={`${item.kind}-${item.name}-${index}`}
                  id={`mention-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={activeMention === index}
                  data-mention-kind={item.kind}
                  className={`mention-option${activeMention === index ? " is-hot" : ""}`}
                  onPointerMove={(event) => {
                    if (event.movementX === 0 && event.movementY === 0) return;
                    setHotMention(index);
                  }}
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
              if (isFileDrag(event) || isGalleryItemDrag(event.dataTransfer.types) || dragIndex == null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              if (isFileDrag(event) || isGalleryItemDrag(event.dataTransfer.types)) return;
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
                      if (isFileDrag(event) || isGalleryItemDrag(event.dataTransfer.types)) return;
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
                      {props.controls?.mentions ? (
                        <span className="attach-chip-token">{token}</span>
                      ) : null}
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
            useCounts={props.modelUses}
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

          {showAspect ? (
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
          ) : null}

          {durationControl?.kind === "enum" ? (
              <ToolbarField label="Duration">
                <select
                  className="select"
                  aria-label="Duration"
                  value={
                    durationControl.values.includes(props.duration)
                      ? props.duration
                      : nearestDurationValue(props.duration, durationControl)
                  }
                  onChange={(e) => props.onDurationChange(e.target.value)}
                >
                  {durationControl.values.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </ToolbarField>
            ) : durationControl?.kind === "int" ? (
              <ToolbarField label="Duration">
                <input
                  className="field"
                  type="number"
                  inputMode="numeric"
                  aria-label="Duration"
                  min={durationControl.min}
                  max={durationControl.max}
                  step={durationControl.step ?? 1}
                  value={props.duration}
                  onChange={(e) =>
                    props.onDurationChange(durationFieldValue(e.target.value, durationControl))
                  }
                  onBlur={() => {
                    const next = nearestDurationValue(props.duration, durationControl);
                    if (next !== props.duration) props.onDurationChange(next);
                  }}
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

          {props.controls?.sampleRate?.kind === "enum" ? (
            <ToolbarField label="Rate">
              <select
                className="select"
                aria-label="Sample rate"
                value={
                  props.controls.sampleRate.values.includes(props.sampleRate ?? "")
                    ? props.sampleRate
                    : nearestDurationValue(props.sampleRate ?? "", props.controls.sampleRate)
                }
                onChange={(e) => props.onSampleRateChange?.(e.target.value)}
              >
                {props.controls.sampleRate.values.map((value) => (
                  <option key={value} value={value}>
                    {value} Hz
                  </option>
                ))}
              </select>
            </ToolbarField>
          ) : null}

          <RangeField
            label="Speed"
            control={props.controls?.speed ?? null}
            value={props.speed ?? ""}
            onChange={props.onSpeedChange}
          />
          <RangeField
            label="Volume"
            control={props.controls?.volume ?? null}
            value={props.volume ?? ""}
            onChange={props.onVolumeChange}
          />
          <RangeField
            label="Pitch"
            control={props.controls?.pitch ?? null}
            value={props.pitch ?? ""}
            onChange={props.onPitchChange}
          />

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

          {props.controls?.safetyTolerance?.kind === "enum" ? (
            <ToolbarField label="Safety">
              <select
                className="select"
                aria-label="Safety tolerance"
                title="Safety tolerance. 0 is strictest."
                value={
                  props.controls.safetyTolerance.values.includes(props.safetyTolerance ?? "")
                    ? props.safetyTolerance
                    : (props.controls.safetyTolerance.defaultValue ??
                      props.controls.safetyTolerance.values[props.controls.safetyTolerance.values.length - 1] ??
                      "")
                }
                onChange={(e) => props.onSafetyToleranceChange?.(e.target.value)}
              >
                {props.controls.safetyTolerance.values.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </ToolbarField>
          ) : (
            <RangeField
              label="Safety"
              control={
                props.controls?.safetyTolerance?.kind === "int" ? props.controls.safetyTolerance : null
              }
              value={props.safetyTolerance ?? ""}
              onChange={props.onSafetyToleranceChange}
            />
          )}

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

          {props.controls?.draft ? (
            <label className="ghost-btn audio-toggle">
              <input
                type="checkbox"
                checked={props.draft === true}
                onChange={(e) => props.onDraftChange?.(e.target.checked)}
              />
              Draft
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

          {showDropzone && fileAccept ? (
            <label className="ghost-btn attach">
              Add media
              <input
                ref={fileRef}
                type="file"
                accept={fileAccept}
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
            {dropPhrase ? `Drop ${dropPhrase}` : "Choose a model that accepts this file"}
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
          accept={fileAccept}
          dropLabel={dropPhrase ? `Drop ${dropPhrase}` : ""}
          onClose={() => setGalleryForMode(null)}
        />
      ) : null}
      </div>
      {hoveredMention
        ? createPortal(
            <div
              ref={hoverTipRef}
              className="mention-hover"
              style={{
                left: hoverPos?.left ?? 0,
                top: hoverPos?.top ?? 0,
                visibility: hoverPos ? "visible" : "hidden",
              }}
              role="tooltip"
            >
              {hoveredMention.item.kind === "audio" ? (
                hoveredMention.item.preview ? (
                  <audio src={hoveredMention.item.preview} controls preload="metadata" />
                ) : (
                  <span className="pill">AUD</span>
                )
              ) : hoveredMention.item.kind === "video" ? (
                <video
                  src={hoveredMention.item.preview}
                  muted
                  playsInline
                  preload="auto"
                  onLoadedData={() => setHoverLayout((n) => n + 1)}
                />
              ) : (
                <img
                  src={hoveredMention.item.preview}
                  alt=""
                  onLoad={() => setHoverLayout((n) => n + 1)}
                />
              )}
              <span>{hoveredMention.item.name}</span>
              <span>{hoveredMention.mention.token}</span>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
