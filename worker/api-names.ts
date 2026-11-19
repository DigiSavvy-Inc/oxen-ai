import {
  NOTE_NEST_MAX,
  noteOnlyCatalog,
  orderedNameCatalog,
  planNameAttachments,
  type HandRef,
  type NameCatalogEntry,
  type NameCatalogItem,
} from "../src/lib/name-mentions";
import { parseNameMentions } from "../src/lib/mentions";
import { getGallery, listGalleries, ownedMediaKey } from "./galleries";
import { acceptGalleryTake } from "./gallery-handle";
import { studioMediaKeyFromUrl } from "./oxen-refs";
import { acceptMediaKind, type MediaKind, type MediaRole, type ModelControls } from "./schema";
import type { Env } from "./types";

/**
 * Server-side @Handle and @Handle.label for API prompts. The catalog is built the way the
 * app builds it, and the planning is the app's own `planNameAttachments`, so a prompt sent
 * by a script resolves to the same files and the same @Image numbers as in the composer.
 */

type Kind = MediaKind;

export type PromptNamesInput = {
  prompt: string;
  modelControls: Pick<ModelControls, "mentions" | "slots" | "frames" | "imageVideoExclusive">;
  /** Files the caller attached by hand, as sent to /api/generate. They keep their numbers. */
  images?: readonly string[];
  videos?: readonly string[];
  audios?: readonly string[];
  /** Adds that project's slots ahead of the Everywhere slots. */
  projectId?: string | null;
};

export type PromptNamesResult = {
  /** The prompt as the model should receive it. */
  prompt: string;
  /** Hand files first, then named files as stored media keys, in @Image / @Video / @Audio order. */
  images: string[];
  videos: string[];
  audios: string[];
  /** Roles aligned with `images` and `videos`. Null for a hand file; the caller's own role applies. */
  roles: { image: (MediaRole | null)[]; video: (MediaRole | null)[] };
  /** Names whose note was written into the prompt. */
  notes: { token: string; note: string }[];
  /** Handles that matched nothing, in plain words. */
  missing: string[];
  /** Files left out because the model's limits were reached, in plain words. */
  trimmed: string[];
};

const KINDS: readonly Kind[] = ["image", "video", "audio"];

type Loader = { slotId: string | null; galleryId: string | null };

type SlotRow = {
  id: string;
  project_id: string | null;
  name: string;
  handle: string;
  take_count: number;
  note: string | null;
  gallery_id: string | null;
};

type SlotFileRow = {
  slot_id: string;
  kind: string;
  name: string;
  media_key: string;
  label: string | null;
  role: string | null;
};

function missingTable(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("no such table") || message.includes("no such column");
}

function slotMax(controls: PromptNamesInput["modelControls"], kind: Kind): number {
  const sizes = controls.slots.filter((slot) => slot.kind === kind).map((slot) => slot.maxItems);
  return sizes.length > 0 ? Math.max(0, ...sizes) : 0;
}

/** Per-kind limits from the model's schema. A kind with no input on the model is 0. */
function slotCaps(controls: PromptNamesInput["modelControls"]): Record<Kind, number> {
  return {
    image: slotMax(controls, "image"),
    video: slotMax(controls, "video"),
    audio: slotMax(controls, "audio"),
  };
}

/**
 * A frames-only model takes its first and last frame by hand and no reference images.
 * A name with a note keeps the note and its other files and loses its images, so it still
 * expands. A name with no note keeps its images, which the planner then drops as over the limit.
 */
function framesOnlyCatalog(entries: readonly NameCatalogEntry[]): NameCatalogEntry[] {
  return entries.map((entry) =>
    (entry.note ?? "").trim() ? { ...entry, items: entry.items.filter((item) => item.kind !== "image") } : entry,
  );
}

function handKey(userId: string, value: string): string | undefined {
  return ownedMediaKey(userId, value) ?? ownedMediaKey(userId, studioMediaKeyFromUrl(value)) ?? undefined;
}

async function profileSlots(
  db: D1Database,
  userId: string,
  profileId: string,
  projectId: string | null,
): Promise<SlotRow[]> {
  try {
    const { results } = await db
      .prepare(
        `SELECT id, project_id, name, handle, take_count, note, gallery_id FROM slots
         WHERE user_id = ? AND profile_id = ? AND (project_id IS NULL OR project_id = ?)
         ORDER BY position ASC`,
      )
      .bind(userId, profileId, projectId ?? "")
      .all<SlotRow>();
    return results ?? [];
  } catch (err) {
    if (missingTable(err)) return [];
    throw err;
  }
}

async function slotFiles(db: D1Database, userId: string, slotIds: string[]): Promise<SlotFileRow[]> {
  if (slotIds.length === 0) return [];
  const rows: SlotFileRow[] = [];
  for (let offset = 0; offset < slotIds.length; offset += 40) {
    const chunk = slotIds.slice(offset, offset + 40);
    const marks = chunk.map(() => "?").join(", ");
    const { results } = await db
      .prepare(
        `SELECT slot_id, kind, name, media_key, label, role FROM slot_files
         WHERE user_id = ? AND slot_id IN (${marks})
         ORDER BY position ASC`,
      )
      .bind(userId, ...chunk)
      .all<SlotFileRow>();
    rows.push(...(results ?? []));
  }
  return rows;
}

/** Handles the prompt reaches, directly or through notes. A superset of what the plan uses. */
function reachedHandles(prompt: string, catalog: readonly NameCatalogEntry[]): Set<string> {
  const byHandle = new Map(catalog.map((entry) => [entry.handle.toLowerCase(), entry]));
  const reached = new Set<string>();
  const walk = (text: string, depth: number) => {
    for (const mention of parseNameMentions(text)) {
      const key = mention.handle.toLowerCase();
      const entry = byHandle.get(key);
      if (!entry || reached.has(key)) continue;
      reached.add(key);
      const note = (entry.note ?? "").trim();
      if (note && depth < NOTE_NEST_MAX) walk(note, depth + 1);
    }
  };
  walk(prompt, 0);
  return reached;
}

function catalogItem(
  userId: string,
  raw: { kind: string; name: string; key: string; label: string | null; role: string | null },
): NameCatalogItem | null {
  const kind = acceptMediaKind(raw.kind);
  const key = ownedMediaKey(userId, raw.key);
  if (!kind || !key) return null;
  return { key, kind, name: raw.name, label: raw.label, role: kind === "audio" ? null : raw.role };
}

/**
 * The profile's names, in the app's order: project slots, Everywhere slots, then galleries.
 * Files are read only for names the prompt reaches, and only when the model takes files.
 */
async function loadCatalog(
  env: Env,
  userId: string,
  profileId: string,
  projectId: string | null,
  prompt: string,
  withFiles: boolean,
): Promise<NameCatalogEntry[]> {
  const loaders = new Map<NameCatalogEntry, Loader>();
  const slotEntry = (row: SlotRow): NameCatalogEntry => {
    const entry: NameCatalogEntry = {
      id: row.id,
      name: row.name,
      handle: row.handle,
      take: acceptGalleryTake(row.take_count) ?? 1,
      note: row.note ?? "",
      source: "slot",
      galleryId: row.gallery_id,
      items: [],
    };
    loaders.set(entry, { slotId: row.gallery_id ? null : row.id, galleryId: row.gallery_id });
    return entry;
  };
  const [slots, summaries] = await Promise.all([
    profileSlots(env.DB, userId, profileId, projectId),
    listGalleries(env.DB, userId, "", profileId),
  ]);
  const project = projectId ? slots.filter((row) => row.project_id === projectId).map(slotEntry) : [];
  const everywhere = slots.filter((row) => row.project_id == null).map(slotEntry);
  const galleries: NameCatalogEntry[] = [];
  for (const summary of summaries) {
    const handle = summary.handle.trim();
    if (!handle) continue;
    const entry: NameCatalogEntry = {
      id: summary.id,
      name: summary.name,
      handle,
      take: summary.takeCount || 1,
      items: [],
    };
    loaders.set(entry, { slotId: null, galleryId: summary.id });
    galleries.push(entry);
  }
  const catalog = orderedNameCatalog({ project, everywhere, galleries });
  if (!withFiles) return catalog;

  const reached = reachedHandles(prompt, catalog);
  const wanted = catalog.filter((entry) => reached.has(entry.handle.toLowerCase()));
  const slotIds = wanted.flatMap((entry) => {
    const id = loaders.get(entry)?.slotId;
    return id ? [id] : [];
  });
  const galleryIds = [...new Set(wanted.flatMap((entry) => {
    const id = loaders.get(entry)?.galleryId;
    return id ? [id] : [];
  }))];
  const [fileRows, loadedGalleries] = await Promise.all([
    slotFiles(env.DB, userId, slotIds),
    Promise.all(galleryIds.map((id) => getGallery(env.DB, userId, id))),
  ]);
  const galleryItems = new Map<string, NameCatalogItem[]>();
  for (const gallery of loadedGalleries) {
    // Only this profile's galleries, even when an older slot links somewhere else.
    if (!gallery || (gallery.profileId ?? "") !== profileId) continue;
    galleryItems.set(
      gallery.id,
      gallery.items.flatMap((item) => {
        const entry = catalogItem(userId, item);
        return entry ? [entry] : [];
      }),
    );
  }
  const slotItems = new Map<string, NameCatalogItem[]>();
  for (const row of fileRows) {
    const item = catalogItem(userId, { ...row, key: row.media_key });
    if (!item) continue;
    const list = slotItems.get(row.slot_id) ?? [];
    list.push(item);
    slotItems.set(row.slot_id, list);
  }
  return catalog.map((entry) => {
    const loader = loaders.get(entry);
    if (!loader || !reached.has(entry.handle.toLowerCase())) return entry;
    if (loader.slotId) return { ...entry, items: slotItems.get(loader.slotId) ?? [] };
    if (loader.galleryId) return { ...entry, items: galleryItems.get(loader.galleryId) ?? [] };
    return entry;
  });
}

function kindWord(kind: Kind, count: number): string {
  switch (kind) {
    case "image":
      return count === 1 ? "image" : "images";
    case "video":
      return count === 1 ? "video" : "videos";
    case "audio":
      return "audio";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

/**
 * Turn @Handle and @Handle.label in an API prompt into the files and @Image numbers the app
 * would send. Reads only the given profile's slots and galleries, and only this user's files.
 */
export async function resolvePromptNames(
  env: Env,
  userId: string,
  profileId: string | null,
  input: PromptNamesInput,
): Promise<PromptNamesResult> {
  const given: Record<Kind, string[]> = {
    image: [...(input.images ?? [])],
    video: [...(input.videos ?? [])],
    audio: [...(input.audios ?? [])],
  };
  const unchanged: PromptNamesResult = {
    prompt: input.prompt,
    images: given.image,
    videos: given.video,
    audios: given.audio,
    roles: { image: given.image.map(() => null), video: given.video.map(() => null) },
    notes: [],
    missing: [],
    trimmed: [],
  };
  if (!profileId || parseNameMentions(input.prompt).length === 0) return unchanged;

  // Files need a model that takes references. A note is plain text, so it expands for any model.
  const controls = input.modelControls;
  const refsOn = controls.mentions;
  const framesOnly = Boolean(controls.frames && !controls.frames.references);
  const full = await loadCatalog(env, userId, profileId, input.projectId ?? null, input.prompt, refsOn);
  const catalog = !refsOn ? noteOnlyCatalog(full) : framesOnly ? framesOnlyCatalog(full) : full;

  const caps = slotCaps(controls);
  // Hand images on a frames-only model are its first and last frame, as in the app.
  const handCaps: Record<Kind, number> = { ...caps, image: framesOnly ? 2 : caps.image };
  const planCaps: Record<Kind, number> = { ...caps, image: framesOnly ? 0 : caps.image };
  let exclusiveOut: Kind | null = null;

  const attempt = () => {
    const hand: Record<Kind, string[]> = { image: [], video: [], audio: [] };
    const handRefs: HandRef[] = [];
    const trimmed: string[] = [];
    for (const kind of KINDS) {
      const cap = Math.max(0, handCaps[kind]);
      hand[kind] = given[kind].slice(0, cap);
      for (const value of hand[kind]) handRefs.push({ key: handKey(userId, value), kind });
      const left = given[kind].length - hand[kind].length;
      if (left <= 0) continue;
      trimmed.push(
        kind === exclusiveOut
          ? `Left out ${left} attached ${kindWord(kind, left)}; keyframes and a continuation clip can’t be used together`
          : `Left out ${left} attached ${kindWord(kind, left)}; the model takes ${cap}`,
      );
    }
    const plan = planNameAttachments({
      prompt: input.prompt,
      galleries: catalog,
      hand: handRefs,
      caps: planCaps,
      flagMissing: refsOn,
    });
    return { hand, trimmed, plan };
  };

  let planned = attempt();
  if (controls.imageVideoExclusive) {
    // Images and a video can't go together. Hand files decide; otherwise the first named file does.
    const keep: Kind | null =
      given.image.length > 0
        ? "image"
        : given.video.length > 0
          ? "video"
          : (planned.plan.files.find((file) => file.kind !== "audio")?.kind ?? null);
    if (keep === "image" || keep === "video") {
      exclusiveOut = keep === "image" ? "video" : "image";
      if (handCaps[exclusiveOut] > 0 || planCaps[exclusiveOut] > 0) {
        handCaps[exclusiveOut] = 0;
        planCaps[exclusiveOut] = 0;
        planned = attempt();
      }
    }
  }
  const { hand, trimmed, plan } = planned;

  const byHandle = new Map(full.map((entry) => [entry.handle.toLowerCase(), entry]));
  // On a frames-only model a label on an image was found; the model just takes no reference images.
  const framesImage = (token: string) => {
    if (!framesOnly) return false;
    const mention = parseNameMentions(token)[0];
    const entry = mention ? byHandle.get(mention.handle.toLowerCase()) : undefined;
    if (!mention || !entry) return false;
    const label = (mention.label ?? "").toLowerCase();
    return entry.items.some((item) => item.kind === "image" && (!label || (item.label ?? "").toLowerCase() === label));
  };
  const missing: string[] = [];
  for (const mention of plan.unresolved) {
    // A name that holds files the model can't take was found; it is left as typed.
    if (!refsOn && byHandle.has(mention.handle.toLowerCase())) {
      trimmed.push(`Left ${mention.token} as typed; the model takes no files`);
    } else if (framesImage(mention.token)) {
      trimmed.push(`Left ${mention.token} as typed; the model takes no reference images`);
    } else missing.push(mention.token);
  }
  for (const miss of plan.missing) {
    if (framesImage(miss.token)) {
      trimmed.push(`Left ${miss.token} in ${miss.inside}’s note as typed; the model takes no reference images`);
    } else missing.push(`${miss.token} in ${miss.inside}’s note`);
  }
  for (const trim of plan.trimmed) {
    trimmed.push(`Trimmed ${trim.token} from ${trim.from} to ${trim.to} ${trim.to === 1 ? "file" : "files"}`);
  }
  for (const token of plan.dropped) trimmed.push(`Dropped ${token}; the model can’t take more files`);

  const named = [...plan.files].sort((a, b) => a.number - b.number);
  const filesOf = (kind: Kind) => named.filter((file) => file.kind === kind);
  // A note is written once per name, however many of its labels the prompt uses.
  const notes = new Map<string, { token: string; note: string }>();
  for (const entry of plan.kept) {
    const note = (entry.note ?? "").trim();
    const key = entry.handle.toLowerCase();
    if (note && !notes.has(key)) notes.set(key, { token: `@${entry.handle}`, note });
  }
  return {
    prompt: plan.expanded,
    images: [...hand.image, ...filesOf("image").map((file) => file.key)],
    videos: [...hand.video, ...filesOf("video").map((file) => file.key)],
    audios: [...hand.audio, ...filesOf("audio").map((file) => file.key)],
    roles: {
      image: [...hand.image.map(() => null), ...filesOf("image").map((file) => file.role)],
      video: [...hand.video.map(() => null), ...filesOf("video").map((file) => file.role)],
    },
    notes: [...notes.values()],
    missing: [...new Set(missing)],
    trimmed: [...new Set(trimmed)],
  };
}
