import { useEffect, useRef, useState } from "react";
import { formatAudioClock } from "../lib/files";

export function AudioAttachControl({
  src,
  name,
  token,
}: {
  src?: string;
  name: string;
  token: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);

  useEffect(() => {
    const node = audioRef.current;
    return () => {
      node?.pause();
    };
  }, [src]);

  function toggle() {
    const node = audioRef.current;
    if (!node || !src) return;
    if (playing) {
      node.pause();
      setPlaying(false);
      return;
    }
    void node
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }

  const clock = formatAudioClock(duration);
  const tip = clock ? `${clock} · ${name}` : name;

  return (
    <div className="attach-audio">
      {src ? (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
          onEnded={() => setPlaying(false)}
        />
      ) : null}
      <button
        type="button"
        className="attach-audio-play"
        disabled={!src}
        onClick={toggle}
        aria-label={playing ? `Pause ${name}` : `Play ${name}`}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <span className="attach-audio-tip" role="tooltip">
        {tip}
        <span>{token}</span>
      </span>
    </div>
  );
}

export function ExpandMediaButton({
  label,
  preview,
  kind,
}: {
  label: string;
  preview: string;
  kind: "image" | "video";
}) {
  return (
    <button type="button" className="attach-zoom" aria-label={label}>
      <MagnifierPlusIcon />
      <span className="attach-zoom-pop" role="tooltip">
        {kind === "video" ? (
          <video src={preview} muted playsInline />
        ) : (
          <img src={preview} alt="" />
        )}
      </span>
    </button>
  );
}

function MagnifierPlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <circle cx="6.5" cy="6.5" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M6.5 4.7v3.6M4.7 6.5h3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M9.7 9.7 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
