import { useState } from "react";
import type { GallerySummary, Generation } from "../lib/api";
import { completedMedia, downloadAllMedia, downloadFilename, downloadMedia } from "../lib/download";
import {
  historyItemForGallery,
  historyItemsForGallery,
  type HistoryGalleryItem,
  type HistoryGalleryNotice,
} from "../lib/gallery-history";
import type { DeleteScope } from "../lib/media-delete";
import {
  actionLabel,
  actionTargets,
  addToGalleryLabel,
  selectionSummary,
} from "../lib/media-selection";
import { DeleteMenu } from "./DeleteMenu";
import { HistoryGalleryActions } from "./HistoryGalleryActions";

function kindLabel(item: Generation): "image" | "video" | "audio" {
  if (item.mediaType === "video") return "video";
  if (item.mediaType === "audio") return "audio";
  return "image";
}

/**
 * The action row under an opened group. Every action takes the ticked images, or the image
 * being shown when none is ticked, so one image stays one click.
 */
export function HistoryGroupBar({
  items,
  shown,
  picked,
  onPickGroup,
  attachedIds,
  attachSupported,
  onAttach,
  summaries,
  onAdd,
  onCreate,
  onDelete,
}: {
  items: Generation[];
  shown: Generation;
  picked: readonly string[];
  /** Tick or clear every image of this group. */
  onPickGroup: (ids: string[], on: boolean) => void;
  attachedIds?: Set<string>;
  attachSupported?: (item: Generation) => boolean;
  onAttach?: (item: Generation) => void;
  summaries: GallerySummary[];
  onAdd: (galleryId: string, items: HistoryGalleryItem[]) => Promise<HistoryGalleryNotice>;
  onCreate: (name: string, items: HistoryGalleryItem[]) => Promise<HistoryGalleryNotice>;
  onDelete?: (ids: string[], scope: DeleteScope) => void;
}) {
  const [note, setNote] = useState<{ text: string; key: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const groupIds = items.map((item) => item.id);
  const targets = actionTargets(groupIds, picked, shown.id);
  const targetKey = targets.ids.join("\n");
  const targetItems = items.filter((item) => targets.ids.includes(item.id));
  const ready = completedMedia(targetItems);
  const multi = items.length > 1;
  const allTicked = targets.fromSelection && targets.ids.length === items.length;
  const kind = kindLabel(shown);
  const shownAttached = Boolean(attachedIds?.has(shown.id));
  const shownAttachable = Boolean(attachSupported?.(shown));

  function attach() {
    if (!onAttach) return;
    if (!targets.fromSelection) {
      if (shownAttachable) onAttach(shown);
      return;
    }
    let attached = 0;
    let skipped = 0;
    for (const item of targetItems) {
      const allowed = Boolean(historyItemForGallery(item)) && (attachSupported ? attachSupported(item) : true);
      if (!allowed) {
        skipped += 1;
        continue;
      }
      onAttach(item);
      attached += 1;
    }
    const text =
      attached === 0
        ? "This model can’t take the selected media."
        : skipped > 0
          ? `Attached ${attached}. Skipped ${skipped}.`
          : `Attached ${attached}.`;
    setNote({ text, key: targetKey });
  }

  async function download() {
    if (ready.length === 0 || downloading) return;
    if (ready.length === 1) {
      void downloadMedia(ready[0].resultUrl ?? "", downloadFilename(ready[0]));
      return;
    }
    setDownloading(true);
    try {
      await downloadAllMedia(ready);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="history-expand-bar" role="group" aria-label="Actions">
      {multi ? (
        <div className="history-expand-pick">
          <span className="history-expand-scope" aria-live="polite">
            {selectionSummary(targets, items.length, kind)}
          </span>
          {allTicked ? null : (
            <button
              type="button"
              className="history-expand-link"
              onClick={() => onPickGroup(groupIds, true)}
            >
              Select all {items.length}
            </button>
          )}
          {targets.fromSelection ? (
            <button
              type="button"
              className="history-expand-link"
              onClick={() => onPickGroup(groupIds, false)}
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="history-expand-actions">
        {onAttach ? (
          <button
            type="button"
            className={`history-expand-attach${!targets.fromSelection && shownAttached ? " is-attached" : ""}`}
            disabled={!targets.fromSelection && !shownAttachable}
            onMouseDown={(event) => event.preventDefault()}
            onClick={attach}
          >
            {targets.fromSelection
              ? actionLabel("Attach", targets)
              : shownAttached
                ? "Attached"
                : shownAttachable
                  ? "Click to attach"
                  : `Can't attach ${kind === "image" ? "images" : kind}`}
          </button>
        ) : null}
        <HistoryGalleryActions
          items={historyItemsForGallery(targetItems)}
          wholeSet={targets.fromSelection ? undefined : historyItemsForGallery(items)}
          addLabel={addToGalleryLabel(targets)}
          summaries={summaries}
          onAdd={onAdd}
          onCreate={onCreate}
        />
        <button
          type="button"
          className="history-gallery-tool"
          disabled={ready.length === 0 || downloading}
          onClick={() => void download()}
        >
          {downloading ? "Downloading…" : actionLabel("Download", targets)}
        </button>
        {onDelete && targets.ids.length > 0 ? (
          <DeleteMenu
            className="history-gallery-tool"
            count={targets.ids.length}
            onChoose={(scope) => onDelete(targets.ids, scope)}
          >
            {actionLabel("Delete", targets)}
          </DeleteMenu>
        ) : null}
      </div>
      {note && note.key === targetKey ? (
        <p className="history-expand-note" role="status">
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
