import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export function ExpandCorners() {
  return (
    <span className="expand-corners" aria-hidden>
      <span className="expand-corner expand-corner-tr" />
      <span className="expand-corner expand-corner-bl" />
    </span>
  );
}

export function FullSizeMedia({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const [actualSize, setActualSize] = useState(false);

  useEffect(() => {
    setActualSize(false);
  }, [src]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

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
