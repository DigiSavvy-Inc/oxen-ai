import { useEffect, useRef, useState, type DragEvent } from "react";
import { MODE_LABELS, type Generation, type GenerationMode } from "../lib/api";
import { isActiveGeneration } from "../lib/batches";
import {
  canvasWashUrl,
  completedMedia,
  downloadAllMedia,
  downloadFilename,
  downloadMedia,
} from "../lib/download";
import { historyItemForGallery } from "../lib/gallery-history";
import { writeHistoryDrag } from "../lib/history-drag";
import { estimateGenerationWait } from "../lib/progress";
import { MAX_TAGS_PER_MEDIA, parseTagList } from "../lib/tags";
import { CopyPrompt } from "./CopyPrompt";
import { DownloadButton } from "./DownloadButton";
import { LastFrameStill } from "./LastFrameStill";
import { ExpandCorners, FullSizeMedia, type FitSlide } from "./FullSizeMedia";
import { Loader } from "./Loader";
import { StagedStill, StagedVideo } from "./StagedStill";

function fitSlides(variants: Generation[]): FitSlide[] {
  return variants.flatMap((item) => {
    if (item.mediaType !== "image" || item.status !== "succeeded" || !item.resultUrl) return [];
    return [{
      id: item.id,
      src: item.resultUrl,
      alt: item.prompt || "Generated",
      poster: item.thumbUrl || null,
    }];
  });
}

function startHistoryDrag(event: DragEvent<HTMLElement>, item: Generation) {
  if (!historyItemForGallery(item)) {
    event.preventDefault();
    return;
  }
  event.stopPropagation();
  writeHistoryDrag(event.dataTransfer, [item.id]);
}

function MediaPreview({
  generation,
  className,
  slides,
  onSlide,
}: {
  generation: Generation;
  className?: string;
  slides: FitSlide[];
  onSlide?: (id: string) => void;
}) {
  const [fitOpen, setFitOpen] = useState(false);
  if (generation.status === "succeeded" && generation.resultUrl) {
    if (generation.mediaType === "video") {
      return (
        <div className="last-frame-pair">
          {generation.lastFrameUrl ? <LastFrameStill src={generation.lastFrameUrl} /> : null}
          <StagedVideo
            key={generation.id}
            className={className}
            src={generation.resultUrl}
            poster={generation.thumbUrl || generation.lastFrameUrl}
            controls
            autoPlay
            loop
            playsInline
            scale
          />
        </div>
      );
    }
    if (generation.mediaType === "audio") {
      return (
        <audio className={`result-audio ${className ?? ""}`} src={generation.resultUrl} controls preload="metadata" />
      );
    }
    const alt = generation.prompt || "Generated";
    return (
      <>
        <button
          type="button"
          className="result-expand"
          aria-label="View full size"
          draggable={Boolean(historyItemForGallery(generation))}
          onDragStart={(event) => startHistoryDrag(event, generation)}
          onClick={() => setFitOpen(true)}
        >
          <StagedStill
            key={generation.id}
            className={className}
            thumb={generation.thumbUrl}
            full={generation.resultUrl}
            alt={alt}
            scale
          />
          <ExpandCorners />
        </button>
        {fitOpen ? (
          <FullSizeMedia
            src={generation.resultUrl}
            alt={alt}
            onClose={() => setFitOpen(false)}
            slides={slides}
            activeId={generation.id}
            onSlide={onSlide}
          />
        ) : null}
      </>
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
  return <WaitPanel generation={generation} />;
}

function WaitPanel({ generation }: { generation: Generation }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [generation.id]);

  const wait = estimateGenerationWait({
    status: generation.status,
    mediaType: generation.mediaType,
    createdAt: generation.createdAt,
    enqueuedAt: generation.enqueuedAt,
    startedAt: generation.startedAt,
    etaSeconds: generation.etaSeconds,
    progress: generation.progress,
    typicalSeconds: generation.typicalSeconds,
    nowMs,
  });

  return (
    <div className="wait-panel" role="status">
      <Loader size="lg" />
      <div className="wait-headline">{wait.headline}</div>
      <div className="wait-remaining">{wait.remainingText}</div>
      <div
        className="wait-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(wait.percent * 100)}
        aria-label={wait.remainingText}
      >
        <div className="wait-bar-fill" style={{ width: `${Math.round(wait.percent * 100)}%` }} />
      </div>
      <div className="wait-typical">{wait.typicalText}</div>
      {generation.errorMessage ? (
        <div className="wait-error">{generation.errorMessage}</div>
      ) : null}
    </div>
  );
}

function TagEditor({
  tags,
  onChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function apply(nextRaw: unknown, nextDraft = "") {
    const next = parseTagList(nextRaw);
    setDraft(nextDraft);
    if (next.join("\0") !== tags.join("\0")) onChange(next);
  }

  return (
    <div className="media-tags">
      {tags.map((tag) => (
        <span key={tag.toLowerCase()} className="tag-chip">
          {tag}
          <button
            type="button"
            className="tag-chip-remove"
            aria-label={`Remove tag ${tag}`}
            onClick={() => apply(tags.filter((item) => item.toLowerCase() !== tag.toLowerCase()))}
          >
            ×
          </button>
        </span>
      ))}
      {tags.length < MAX_TAGS_PER_MEDIA ? (
        <input
          className="tag-input"
          value={draft}
          placeholder={tags.length === 0 ? "Add tag" : "Add"}
          aria-label="Add tag"
          onChange={(event) => {
            const value = event.target.value;
            if (value.includes(",")) {
              const parts = value.split(",");
              const last = parts.pop() ?? "";
              apply([...tags, ...parts], last);
              return;
            }
            setDraft(value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply([...tags, draft]);
            } else if (event.key === "Backspace" && !draft && tags.length > 0) {
              apply(tags.slice(0, -1));
            }
          }}
          onBlur={() => {
            if (draft.trim()) apply([...tags, draft]);
          }}
        />
      ) : null}
    </div>
  );
}

function draftStillRenderable(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true;
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return true;
  return at > Date.now();
}

function draftExpiryLabel(expiresAt: string | null | undefined): string | null {
  if (!expiresAt) return null;
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return null;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function draftResultNote(expiresAt: string | null | undefined): string {
  if (!draftStillRenderable(expiresAt)) {
    return "This 480p preview has expired, so it cannot be rendered at 1080p.";
  }
  const until = draftExpiryLabel(expiresAt);
  return until
    ? `This preview is 480p. Render 1080p re-makes the same shot. Available until ${until}.`
    : "This preview is 480p. Render 1080p re-makes the same shot. Available for 7 days.";
}

export function Canvas({
  generation,
  variants,
  onSelect,
  onTagsChange,
  onDelete,
  onRenderFinal,
  renderBusy,
}: {
  generation: Generation | null;
  variants: Generation[];
  onSelect: (id: string) => void;
  onTagsChange: (id: string, tags: string[]) => void;
  onDelete?: (id: string) => void;
  onRenderFinal?: (generation: Generation) => void;
  renderBusy?: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const generationId = generation?.id ?? null;
  const resultUrl = generation?.resultUrl ?? null;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !generationId) return;
    if (!window.matchMedia("(max-width: 860px)").matches) return;
    const scrollport = frame.closest(".main");
    if (!(scrollport instanceof HTMLElement)) return;
    const frameBox = frame.getBoundingClientRect();
    const portBox = scrollport.getBoundingClientRect();
    const topIsVisible = frameBox.top >= portBox.top && frameBox.top < portBox.bottom;
    if (topIsVisible) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    frame.scrollIntoView({
      block: resultUrl ? "start" : "nearest",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [generationId, resultUrl]);

  if (!generation) {
    return (
      <div className="canvas">
        <div className="canvas-empty">
          <h2>What do you want to make?</h2>
          <p>
            Pick a mode, choose a model, and describe the image, video, or audio. This canvas stays on the
            current session — open Library when you want past work.
          </p>
          <ul className="canvas-ways">
            <li>
              <strong>Draft mode.</strong> On Seedance 2.5, check 480p draft and generate. When the
              preview finishes, press Render 1080p. It re-makes the same shot, and the preview lasts
              7 days.
            </li>
            <li>
              <strong>Multi-shot.</strong> When the model offers Add shot, the box is shot 1. Each
              added shot has its own prompt and duration, and Generate sends them as one video.
            </li>
            <li>
              <strong>Chat.</strong> Choose Chat, pick a chat model, and send a question. Drop an
              image or a PDF, 24MB or smaller, if the model should look at it.
            </li>
          </ul>
        </div>
      </div>
    );
  }

  const label = MODE_LABELS[generation.mode as GenerationMode] || generation.mode;
  const showStrip = variants.length > 1;
  const readyVariants = completedMedia(variants);
  const slides = fitSlides(variants);
  const canDownload = Boolean(generation.status === "succeeded" && generation.resultUrl);
  const washUrl = canvasWashUrl(generation);

  return (
    <div className="canvas">
      <div className="result-frame" ref={frameRef}>
        <div className="frame-head">
          <h3>
            {label} · {generation.model}
          </h3>
          <div className="frame-head-actions">
            <span className={`pill ${generation.status === "succeeded" ? "ok" : "warn"}`}>
              {generation.status}
            </span>
            {generation.draftTaskId && generation.status === "succeeded" && onRenderFinal ? (
              <button
                type="button"
                className="ghost-btn"
                disabled={renderBusy || !draftStillRenderable(generation.draftExpiresAt)}
                title={
                  draftStillRenderable(generation.draftExpiresAt)
                    ? "Re-render this 480p draft at 1080p"
                    : "This 480p draft has expired"
                }
                onClick={() => onRenderFinal(generation)}
              >
                Render 1080p
              </button>
            ) : null}
            {onDelete ? (
              <button type="button" className="ghost-btn" onClick={() => onDelete(generation.id)}>
                Delete
              </button>
            ) : null}
          </div>
        </div>
        {generation.draftTaskId && generation.status === "succeeded" ? (
          <p className="result-note">{draftResultNote(generation.draftExpiresAt)}</p>
        ) : null}
        <div className={`result-stage${showStrip ? " has-strip" : ""}`}>
          <div className={`result-media${washUrl ? " has-wash" : ""}`}>
            {washUrl ? (
              <img className="result-media-wash" src={washUrl} alt="" aria-hidden />
            ) : null}
            <MediaPreview
              generation={generation}
              className="result-preview"
              slides={slides}
              onSlide={onSelect}
            />
            {canDownload && generation.resultUrl ? (
              <div className="media-actions">
                <DownloadButton
                  label="Download"
                  onDownload={() =>
                    void downloadMedia(generation.resultUrl ?? "", downloadFilename(generation))
                  }
                />
                {readyVariants.length > 1 ? (
                  <DownloadButton
                    className="media-download-all"
                    caption="All"
                    label={`Download all ${readyVariants.length} completed`}
                    onDownload={() => void downloadAllMedia(readyVariants)}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
          {showStrip ? (
            <div className="variation-strip" role="list" aria-label="Variations">
              {variants.map((item, index) => (
                <div
                  key={item.id}
                  className={`variation-thumb${item.id === generation.id ? " active" : ""}`}
                  role="listitem"
                >
                  <button
                    type="button"
                    className="variation-thumb-hit"
                    draggable={Boolean(historyItemForGallery(item))}
                    onDragStart={(event) => startHistoryDrag(event, item)}
                    onClick={() => onSelect(item.id)}
                    title={`Variation ${index + 1}`}
                    aria-label={`Variation ${index + 1}${item.mediaType === "video" ? ", video" : item.mediaType === "audio" ? ", audio" : ""}`}
                    aria-current={item.id === generation.id ? "true" : undefined}
                  >
                    {item.mediaType === "image" && item.thumbUrl ? (
                      <img src={item.thumbUrl} alt="" draggable={false} />
                    ) : item.resultUrl && item.mediaType === "video" ? (
                      <video src={item.resultUrl} muted playsInline preload="metadata" draggable={false} />
                    ) : (
                      <span className="variation-placeholder">
                        {isActiveGeneration(item) && !item.resultUrl && !item.thumbUrl ? (
                          <Loader size="sm" />
                        ) : (
                          index + 1
                        )}
                      </span>
                    )}
                    {item.mediaType === "video" && item.resultUrl ? (
                      <span className="variation-play" aria-hidden>
                        ▶
                      </span>
                    ) : null}
                    <span className="variation-index">{index + 1}</span>
                  </button>
                  {item.resultUrl && item.status === "succeeded" ? (
                    <DownloadButton
                      label={`Download variation ${index + 1}`}
                      onDownload={() =>
                        void downloadMedia(item.resultUrl ?? "", downloadFilename(item))
                      }
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {generation.prompt ? <CopyPrompt prompt={generation.prompt} /> : null}
        <TagEditor
          tags={generation.tags ?? []}
          onChange={(tags) => onTagsChange(generation.id, tags)}
        />
      </div>
    </div>
  );
}
