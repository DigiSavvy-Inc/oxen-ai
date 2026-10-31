import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type TransitionEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  acceptsSwipePointer,
  pointerHitsVideoControls,
  pointerSwipe,
  wheelSwipe,
  type SwipeStep,
  type WheelAccum,
} from "../lib/slide-swipe";
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

type GesturePhase = "idle" | "dragging" | "settling";

type Gesture = {
  id: number;
  x: number;
  y: number;
  axis: "pending" | "x";
};

const TRACK_REST = "translate3d(-33.333333%, 0, 0)";
const TRACK_EASE = "transform 240ms cubic-bezier(0.22, 0.8, 0.2, 1)";

function fitMediaKind(value: FitMediaKind | undefined): FitMediaKind {
  return value === "video" ? "video" : "image";
}

function slideAt(slides: readonly FitSlide[], activeId: string | undefined, delta: number): FitSlide | null {
  if (slides.length === 0) return null;
  const index = slides.findIndex((slide) => slide.id === activeId);
  const from = index >= 0 ? index : 0;
  return slides[(from + delta + slides.length) % slides.length] ?? null;
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
  const [phase, setPhase] = useState<GesturePhase>("idle");
  const backdropRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const pendingStep = useRef<SwipeStep>(0);
  const phaseRef = useRef<GesturePhase>("idle");
  const active = slides.find((slide) => slide.id === activeId);
  const kind = fitMediaKind(active?.mediaType ?? mediaType);
  const poster = active?.poster ?? null;
  const slideKey = active?.id ?? src;
  const canCycle = !actualSize && slides.length > 1 && Boolean(onSlide);
  const current: FitSlide = active ?? { id: slideKey, src, alt, mediaType: kind, poster };
  const previous = canCycle ? slideAt(slides, activeId, -1) : null;
  const next = canCycle ? slideAt(slides, activeId, 1) : null;

  const step = useCallback(
    (delta: number) => {
      if (!canCycle || !onSlide) return;
      const upcoming = slideAt(slides, activeId, delta);
      if (upcoming) onSlide(upcoming.id);
    },
    [canCycle, slides, activeId, onSlide],
  );
  const stepRef = useRef(step);
  stepRef.current = step;

  function setGesturePhase(nextPhase: GesturePhase) {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }

  function placeTrack(offset: number, animate: boolean) {
    const node = trackRef.current;
    if (!node) return;
    node.style.transition = animate ? TRACK_EASE : "none";
    node.style.transform = offset === 0 ? TRACK_REST : `translate3d(calc(-33.333333% + ${offset}px), 0, 0)`;
  }

  const commitSettle = useCallback(() => {
    if (phaseRef.current !== "settling") return;
    const delta = pendingStep.current;
    pendingStep.current = 0;
    setGesturePhase("idle");
    placeTrack(0, false);
    if (delta) stepRef.current(delta);
  }, []);
  const commitRef = useRef(commitSettle);
  commitRef.current = commitSettle;

  function beginSettle(delta: SwipeStep) {
    if (phaseRef.current === "settling") return;
    const width = stageRef.current?.clientWidth ?? 0;
    if (delta !== 0 && width <= 0) {
      stepRef.current(delta);
      return;
    }
    if (delta === 0) {
      pendingStep.current = 0;
      setGesturePhase("settling");
      placeTrack(0, true);
      return;
    }
    pendingStep.current = delta;
    setGesturePhase("settling");
    placeTrack(delta > 0 ? -width : width, true);
  }

  useLayoutEffect(() => {
    if (!canCycle || phaseRef.current !== "idle") return;
    placeTrack(0, false);
  }, [canCycle, activeId]);

  useEffect(() => {
    setActualSize(false);
  }, [src]);

  useEffect(() => {
    if (phase !== "settling") return;
    const timer = window.setTimeout(() => commitRef.current(), 280);
    return () => window.clearTimeout(timer);
  }, [phase]);

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
      beginSettle(event.key === "ArrowLeft" ? -1 : 1);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, canCycle]);

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
      beginSettle(delta);
    }
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
      window.clearTimeout(resetTimer);
    };
  }, [canCycle]);

  function blocksSwipe(event: PointerEvent<HTMLDivElement>): boolean {
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (target.closest("button, a, input, textarea, select, audio")) return true;
    const video = target.closest("video");
    if (!video) return false;
    const rect = video.getBoundingClientRect();
    return pointerHitsVideoControls(event.clientY, rect.top, rect.height);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    suppressClick.current = false;
    if (!canCycle || !event.isPrimary || !acceptsSwipePointer(event.pointerType)) return;
    if (phaseRef.current === "settling") return;
    if (blocksSwipe(event)) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, axis: "pending" };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (start.axis === "pending") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        gesture.current = null;
        return;
      }
      start.axis = "x";
      suppressClick.current = true;
      setGesturePhase("dragging");
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture can fail if the pointer already ended. The swipe still
        // completes when the finger lifts over the lightbox.
      }
    }
    placeTrack(dx, false);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    gesture.current = null;
    if (!start || start.id !== event.pointerId) return;
    if (start.axis !== "x") return;
    const delta = pointerSwipe(start, { x: event.clientX, y: event.clientY });
    beginSettle(delta);
  }

  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (!start || start.id !== event.pointerId) return;
    gesture.current = null;
    if (start.axis === "x") beginSettle(0);
  }

  function onTrackEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.propertyName !== "transform") return;
    if (event.target !== event.currentTarget) return;
    commitRef.current();
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  function renderSlide(slide: FitSlide, interactive: boolean) {
    const poster = slide.poster ?? null;
    const slideKind = fitMediaKind(slide.mediaType);
    if (slideKind === "video") {
      if (!interactive && poster) return <img src={poster} alt="" />;
      return (
        <StagedVideo
          src={slide.src}
          poster={poster}
          label={slide.alt}
          controls={interactive}
          playsInline
          preload="metadata"
          muted={!interactive}
          scale
          onClick={interactive ? (event) => event.stopPropagation() : undefined}
        />
      );
    }
    if (interactive && actualSize) {
      return (
        <img
          src={slide.src}
          alt={slide.alt}
          title="Fit to the window"
          onClick={(event) => {
            event.stopPropagation();
            setActualSize((value) => !value);
          }}
        />
      );
    }
    return (
      <StagedStill
        thumb={poster}
        full={slide.src}
        alt={interactive ? slide.alt : ""}
        title={interactive ? "Actual size" : undefined}
        scale
        onClick={
          interactive
            ? (event) => {
                event.stopPropagation();
                setActualSize((value) => !value);
              }
            : undefined
        }
      />
    );
  }

  function slotKey(slide: FitSlide, slot: "prev" | "current" | "next"): string {
    if (slides.length === 2 && slot !== "current") return `${slide.id}:${slot}`;
    return slide.id;
  }

  return createPortal(
    <div
      ref={backdropRef}
      className={`fullsize-backdrop${actualSize ? " is-actual" : ""}${canCycle ? " is-swipeable" : ""}${phase === "dragging" ? " is-dragging" : ""}${phase === "settling" ? " is-settling" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
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
            beginSettle(-1);
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
            beginSettle(1);
          }}
        >
          ›
        </button>
      ) : null}
      {canCycle && previous && next ? (
        <div className="fullsize-stage" ref={stageRef}>
          <div className="fullsize-track is-cycle" ref={trackRef} onTransitionEnd={onTrackEnd}>
            <div key={slotKey(previous, "prev")} className="fullsize-slide is-peek" aria-hidden>
              {renderSlide(previous, false)}
            </div>
            <div key={slotKey(current, "current")} className="fullsize-slide">
              {renderSlide(current, true)}
            </div>
            <div key={slotKey(next, "next")} className="fullsize-slide is-peek" aria-hidden>
              {renderSlide(next, false)}
            </div>
          </div>
        </div>
      ) : kind === "video" ? (
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
      ) : (
        renderSlide(current, true)
      )}
    </div>,
    document.body,
  );
}
