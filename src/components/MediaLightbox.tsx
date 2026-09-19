import { useEffect } from "react";

export type LightboxMedia = {
  name: string;
  preview: string;
  kind: "image" | "video" | "audio";
};

export function MediaLightbox({
  item,
  onClose,
}: {
  item: LightboxMedia;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="media-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      onClick={onClose}
    >
      <div className="media-lightbox-stage" onClick={(event) => event.stopPropagation()}>
        {item.kind === "video" && item.preview ? (
          <video src={item.preview} controls autoPlay playsInline />
        ) : item.kind === "image" && item.preview ? (
          <img src={item.preview} alt={item.name} />
        ) : (
          <p className="media-lightbox-fallback">{item.name}</p>
        )}
      </div>
      <button className="media-lightbox-close" type="button" onClick={onClose}>
        Close
      </button>
    </div>
  );
}

function MagnifierIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <circle cx="7" cy="7" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10.2 10.2 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ExpandMediaButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="attach-zoom" aria-label={label} onClick={onClick}>
      <MagnifierIcon />
    </button>
  );
}
