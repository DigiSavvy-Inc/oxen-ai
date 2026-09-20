import { useState } from "react";
import { copyText } from "../lib/clipboard";

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <rect
        x="5.2"
        y="5.2"
        width="7.4"
        height="8.2"
        rx="1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M3.6 10.4V3.8c0-.8.6-1.4 1.4-1.4h6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path
        d="M3.6 8.4 6.6 11.4 12.4 4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CopyPrompt({
  prompt,
  className,
}: {
  prompt: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    const ok = await copyText(prompt);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={`prompt-quote${className ? ` ${className}` : ""}`}>
      <p className="prompt-quote-text">{prompt}</p>
      <button
        type="button"
        className={`icon-btn prompt-copy${copied ? " is-copied" : ""}`}
        aria-label={copied ? "Prompt copied" : "Copy prompt"}
        title={copied ? "Copied" : "Copy prompt"}
        onClick={() => void onCopy()}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}
