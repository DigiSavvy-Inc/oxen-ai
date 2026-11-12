/** Where a delete reaches. "studio" leaves the Oxen copy alone. */
export type DeleteScope = "studio" | "everywhere";

export type DeleteChoice = {
  scope: DeleteScope;
  title: string;
  detail: string;
  danger: boolean;
};

export function itemCount(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}

/** The two rows of the Delete menu, in the order they are shown. The permanent one is last. */
export function deleteChoices(count: number): DeleteChoice[] {
  const many = count !== 1;
  return [
    {
      scope: "studio",
      title: "Remove from Studio",
      detail: `Takes ${itemCount(count)} out of Studio. Oxen keeps ${many ? "its copies" : "its copy"}.`,
      danger: false,
    },
    {
      scope: "everywhere",
      title: "Delete everywhere",
      detail: `Deletes ${itemCount(count)} from Studio and Oxen. Can’t be undone.`,
      danger: true,
    },
  ];
}

/** A menu ignores choices for this long after it opens, so a double-click on Delete picks nothing. */
export const DELETE_MENU_ARM_MS = 250;

export function deleteMenuArmed(openedAt: number, now: number): boolean {
  return now - openedAt >= DELETE_MENU_ARM_MS;
}

export type DeleteReply = {
  /** Oxen copies the server deleted. */
  oxenDeleted: number;
  /** Oxen copies the server looked for and did not find. */
  oxenGone: number;
  /** Oxen copies that are still there because the delete failed. */
  oxenFailed: number;
};

const DELETED_KEYS = ["oxenDeleted", "oxen_deleted", "oxenRemoved"];
const GONE_KEYS = [
  "oxenGone",
  "oxenMissing",
  "oxenAlreadyGone",
  "oxenNotFound",
  "oxenAbsent",
  "oxenSkipped",
  "oxen_gone",
  "oxen_missing",
];
const FAILED_KEYS = ["oxenFailed", "oxen_failed", "oxenErrors"];
const GONE_WORDS = new Set(["gone", "missing", "already_gone", "already-gone", "not_found", "not-found", "absent", "none", "skipped"]);
const DELETED_WORDS = new Set(["deleted", "removed", "ok"]);
const FAILED_WORDS = new Set(["failed", "error"]);

function countOf(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (value === true) return 1;
  if (Array.isArray(value)) return value.length;
  return 0;
}

function firstCount(source: Record<string, unknown>, keys: readonly string[]): number {
  for (const key of keys) {
    const count = countOf(source[key]);
    if (count > 0) return count;
  }
  return 0;
}

/**
 * Reads the Oxen outcome of one delete response. Field names have changed over time, so a
 * count is taken from whichever known name carries it, and anything unrecognised counts as zero.
 */
export function readDeleteReply(body: unknown): DeleteReply {
  const reply: DeleteReply = { oxenDeleted: 0, oxenGone: 0, oxenFailed: 0 };
  if (typeof body !== "object" || body === null) return reply;
  const source = body as Record<string, unknown>;
  reply.oxenDeleted = firstCount(source, DELETED_KEYS);
  reply.oxenGone = firstCount(source, GONE_KEYS);
  reply.oxenFailed = firstCount(source, FAILED_KEYS);

  const nested = source.oxen;
  if (typeof nested === "string") {
    const word = nested.trim().toLowerCase();
    if (DELETED_WORDS.has(word)) reply.oxenDeleted ||= 1;
    else if (GONE_WORDS.has(word)) reply.oxenGone ||= 1;
    else if (FAILED_WORDS.has(word)) reply.oxenFailed ||= 1;
  } else if (typeof nested === "object" && nested !== null) {
    const inner = nested as Record<string, unknown>;
    reply.oxenDeleted ||= firstCount(inner, ["deleted", "removed"]);
    reply.oxenGone ||= firstCount(inner, ["gone", "missing", "alreadyGone", "notFound", "absent", "skipped"]);
    reply.oxenFailed ||= firstCount(inner, ["failed", "errors"]);
  }
  return reply;
}

/** The most ids the server takes in one delete request. */
export const DELETE_BATCH_MAX = 200;

/** Splits a selection into requests the server accepts, keeping the order. */
export function deleteBatches(ids: readonly string[], size = DELETE_BATCH_MAX): string[][] {
  const unique = [...new Set(ids)];
  const batches: string[][] = [];
  for (let at = 0; at < unique.length; at += size) batches.push(unique.slice(at, at + size));
  return batches;
}

/** The answer to one delete request, which may cover several items. */
export type DeleteResult = { ok: true; count: number; reply: unknown } | { ok: false; count: number };

export type DeleteTally = {
  scope: DeleteScope;
  requested: number;
  /** Items that left Studio. */
  removed: number;
  /** Items the server refused or never answered for. They are still in the library. */
  failed: number;
  oxenDeleted: number;
  /** Removed items with nothing on Oxen: already deleted there, or never saved. */
  oxenGone: number;
  oxenFailed: number;
};

/**
 * Adds up the requests of one delete. Each item has at most one Oxen copy, so the counts in a
 * reply are capped at the items it covers, and an item the reply does not mention had no copy.
 */
export function tallyDelete(scope: DeleteScope, results: readonly DeleteResult[]): DeleteTally {
  const tally: DeleteTally = {
    scope,
    requested: 0,
    removed: 0,
    failed: 0,
    oxenDeleted: 0,
    oxenGone: 0,
    oxenFailed: 0,
  };
  for (const result of results) {
    const count = Math.max(0, Math.floor(result.count));
    tally.requested += count;
    if (!result.ok) {
      tally.failed += count;
      continue;
    }
    tally.removed += count;
    if (scope !== "everywhere") continue;
    const reply = readDeleteReply(result.reply);
    const failed = Math.min(reply.oxenFailed, count);
    const deleted = Math.min(reply.oxenDeleted, count - failed);
    tally.oxenFailed += failed;
    tally.oxenDeleted += deleted;
    tally.oxenGone += count - failed - deleted;
  }
  return tally;
}

export type DeleteOutcome = {
  /** "warn" when something the person asked for did not happen. */
  tone: "ok" | "warn";
  text: string;
};

function copies(count: number): string {
  return count === 1 ? "1 Oxen copy" : `${count} Oxen copies`;
}

/** The line shown after a delete. A copy that Oxen no longer had is reported plainly, not as a fault. */
export function deleteOutcome(tally: DeleteTally): DeleteOutcome {
  const parts: string[] = [];
  let tone: DeleteOutcome["tone"] = "ok";

  if (tally.removed > 0) {
    if (tally.scope === "studio") {
      parts.push(`Removed ${itemCount(tally.removed)} from Studio.`);
    } else if (tally.oxenFailed === 0 && tally.oxenGone === 0) {
      parts.push(`Deleted ${itemCount(tally.removed)} from Studio and Oxen.`);
    } else {
      parts.push(`Removed ${itemCount(tally.removed)} from Studio.`);
      if (tally.oxenDeleted > 0) parts.push(`Deleted ${copies(tally.oxenDeleted)}.`);
      if (tally.oxenGone > 0) {
        parts.push(
          tally.oxenGone === tally.removed
            ? "There was no Oxen copy to delete."
            : `${tally.oxenGone} had no Oxen copy to delete.`,
        );
      }
      if (tally.oxenFailed > 0) {
        tone = "warn";
        const one = tally.oxenFailed === 1;
        const held =
          tally.oxenFailed < tally.removed
            ? `${tally.oxenFailed} of them`
            : one
              ? "its copy"
              : "their copies";
        parts.push(`Oxen still has ${held}. Delete ${one ? "it" : "them"} from your Oxen account.`);
      }
    }
  }

  if (tally.failed > 0) {
    tone = "warn";
    parts.push(
      tally.failed === tally.requested
        ? `Couldn’t delete ${tally.requested === 1 ? "that item" : `those ${tally.requested} items`}. Nothing changed.`
        : `Couldn’t delete ${tally.failed} of ${tally.requested}. ${tally.failed === 1 ? "It is" : "They are"} still in the library.`,
    );
  }

  return { tone, text: parts.join(" ") };
}

function files(count: number): string {
  return count === 1 ? "1 Oxen file" : `${count} Oxen files`;
}

/** What a cleanup did to the Oxen files, as sentences. Empty when the reply names none. */
export function oxenFilesNote(body: unknown): string {
  const reply = readDeleteReply(body);
  const parts: string[] = [];
  if (reply.oxenDeleted > 0) parts.push(`Removed ${files(reply.oxenDeleted)}.`);
  if (reply.oxenGone > 0) {
    parts.push(`${files(reply.oxenGone)} ${reply.oxenGone === 1 ? "was" : "were"} already gone.`);
  }
  if (reply.oxenFailed > 0) parts.push(`${files(reply.oxenFailed)} could not be removed.`);
  return parts.join(" ");
}
