import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { acceptsSwipePointer, pointerSwipe, wheelSwipe, type WheelAccum } from "../lib/slide-swipe";
import { StagedStill, StagedVideo } from "./StagedStill";

export function ExpandCorners() {
  return (
    <span className="expand-corners" aria-hidden>
      <span className="expand-corner expand-corner-tr" />
      <span className="expand-corner expand-corner-bl" />
    </span>
  );
}

export type FitMediaKind = "image" | "video";

export type FitSlide = {
  id: string;
  src: string;
  alt: string;
  mediaType?: FitMediaKind;
  poster?: string | null;
};

function fitMediaKind(value: FitMediaKind | undefined): FitMediaKind {
  return value === "video" ? "video" : "image";
}

export function FullSizeMedia({
  src,
  alt,
  onClose,
  slides = [],
  activeId,
  onSlide,
  mediaType,
}: {
  src: string;
  alt: string;
  onClose: () => void;
  slides?: FitSlide[];
  activeId?: string;
  onSlide?: (id: string) => void;
  mediaType?: FitMediaKind;
}) {
  const [actualSize, setActualSize] = useState(false);
  const backdropRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const active = slides.find((slide) => slide.id === activeId);
  const kind = fitMediaKind(active?.mediaType ?? mediaType);
  const poster = active?.poster ?? null;
  const slideKey = active?.id ?? src;
  const canCycle = !actualSize && slides.length > 1 && Boolean(onSlide);

  const step = useCallback(
    (delta: number) => {
      if (!canCycle || !onSlide) return;
      const index = slides.findIndex((slide) => slide.id === activeId);
      const from = index >= 0 ? index : 0;
      const next = slides[(from + delta + slides.length) % slides.length];
      if (next) onSlide(next.id);
    },
    [canCycle, slides, activeId, onSlide],
  );

  useEffect(() => {
    setActualSize(false);
  }, [src]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (!canCycle) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      step(event.key === "ArrowLeft" ? -1 : 1);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, canCycle, step]);

  useEffect(() => {
    const node = backdropRef.current;
    if (!node || !canCycle) return;
    const accum: WheelAccum = { x: 0, y: 0 };
    let resetTimer = 0;
    function onWheel(event: WheelEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const delta = wheelSwipe(accum, event.deltaX, event.deltaY, event.deltaMode);
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        accum.x = 0;
        accum.y = 0;
      }, 180);
      if (delta === 0) return;
      event.preventDefault();
      step(delta);
    }
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
      window.clearTimeout(resetTimer);
    };
  }, [canCycle, step]);

  function blocksSwipe(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest("button, a, input, textarea, select, video, audio"));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    if (!canCycle || !event.isPrimary || !acceptsSwipePointer(event.pointerType)) return;
    if (blocksSwipe(event.target)) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the pointer already ended. The swipe still
      // completes when the finger lifts over the lightbox.
    }
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    gesture.current = null;
    if (!start || start.id !== event.pointerId) return;
    const delta = pointerSwipe(start, { x: event.clientX, y: event.clientY });
    if (delta === 0) return;
    suppressClick.current = true;
    step(delta);
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.id === event.pointerId) gesture.current = null;
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return createPortal(
    <div
      ref={backdropRef}
      className={`fullsize-backdrop${actualSize ? " is-actual" : ""}${canCycle ? " is-swipeable" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClickCapture={onClickCapture}
      onClick={onClose}
    >
      <button type="button" className="icon-btn fullsize-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
      {canCycle ? (
        <button
          type="button"
          className="icon-btn fullsize-nav is-prev"
          aria-label="Previous"
          onClick={(event) => {
            event.stopPropagation();
            step(-1);
          }}
        >
          ‹
        </button>
      ) : null}
      {canCycle ? (
        <button
          type="button"
          className="icon-btn fullsize-nav is-next"
          aria-label="Next"
          onClick={(event) => {
            event.stopPropagation();
            step(1);
          }}
        >
          ›
        </button>
      ) : null}
      {kind === "video" ? (
        <StagedVideo
          key={slideKey}
          src={src}
          poster={poster}
          label={alt}
          controls
          playsInline
          preload="metadata"
          scale
          onClick={(event) => event.stopPropagation()}
        />
      ) : actualSize ? (
        <img
          src={src}
          alt={alt}
          title="Fit to the window"
          onClick={(event) => {
            event.stopPropagation();
            setActualSize((value) => !value);
          }}
        />
      ) : (
        <StagedStill
          key={slideKey}
          thumb={poster}
          full={src}
          alt={alt}
          title="Actual size"
          scale
          onClick={(event) => {
            event.stopPropagation();
            setActualSize((value) => !value);
          }}
        />
      )}
    </div>,
    document.body,
  );
}
