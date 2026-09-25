import { useState } from "react";
import { FullSizeMedia } from "./FullSizeMedia";

export function LastFrameStill({ src }: { src: string }) {
  const [open, setOpen] = useState(false);
  return (
    <figure className="last-frame">
      <button
        type="button"
        className="last-frame-hit"
        aria-label="View last frame"
        onClick={() => setOpen(true)}
      >
        <img src={src} alt="Last frame" />
      </button>
      {open ? (
        <FullSizeMedia src={src} alt="Last frame" onClose={() => setOpen(false)} />
      ) : null}
    </figure>
  );
}
