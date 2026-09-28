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
  cycleHotIndex,
  deleteMentionToken,
  filterMentionItems,
  indexAfterInsertBefore,
  insertMentionToken,
  mentionAtCaret,
  mentionOrdered,
  promptHighlightParts,
  tokenForItem,
  type PromptMention,
} from "../lib/mentions";
import { shortenFileName } from "../lib/files";
import { acceptedMediaKinds, fileAcceptValue, mediaKindPhrase, attachKindCap } from "../lib/library-refs";
import { aspectCatalog, aspectSelectOptions } from "../lib/params";
import { durationFieldValue, durationToSend, nearestDurationValue } from "../../worker/schema";
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
