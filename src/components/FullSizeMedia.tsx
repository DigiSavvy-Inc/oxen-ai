import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function ExpandCorners() {
  return (
    <span className="expand-corners" aria-hidden>
      <span className="expand-corner expand-corner-tr" />
      <span className="expand-corner expand-corner-bl" />
    </span>
  );
}

export type FitSlide = {
  id: string;
  src: string;
  alt: string;
};

export function FullSizeMedia({
  src,
  alt,
  onClose,
  slides = [],
  activeId,
  onSlide,
}: {
  src: string;
  alt: string;
  onClose: () => void;
  slides?: FitSlide[];
  activeId?: string;
  onSlide?: (id: string) => void;
}) {
  const [actualSize, setActualSize] = useState(false);
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

  return createPortal(
    <div
      className={`fullsize-backdrop${actualSize ? " is-actual" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
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
      <img
        src={src}
        alt={alt}
        title={actualSize ? "Fit to the window" : "Actual size"}
        onClick={(event) => {
          event.stopPropagation();
          setActualSize((value) => !value);
        }}
      />
    </div>,
    document.body,
  );
}
