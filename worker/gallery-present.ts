import type { GalleryKind, StoredGallery, StoredGalleryItem } from "./galleries";
import { getGallery, listGalleries } from "./galleries";
import { displayStoredMediaUrl } from "./media";
import { ensureDefaultProfile } from "./profiles";
import type { Env } from "./types";

export type GalleryPreviewJson = {
  kind: GalleryKind;
  name: string;
  thumbUrl: string | null;
};

export type GalleryCardJson = {
  id: string;
  name: string;
  updatedAt: number;
  count: number;
  previews: GalleryPreviewJson[];
};

/** One featured image plus three rows of thumbs on a wide library panel. */
const PREVIEW_COUNT = 36;
const THUMB_CHUNK = 40;

async function thumbKeyByResult(
  db: D1Database,
  userId: string,
  keys: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(keys.filter(Boolean))];
  for (let offset = 0; offset < unique.length; offset += THUMB_CHUNK) {
    const chunk = unique.slice(offset, offset + THUMB_CHUNK);
    if (chunk.length === 0) continue;
    try {
      const placeholders = chunk.map(() => "?").join(", ");
      const { results } = await db
        .prepare(
          `SELECT result_key, thumb_key FROM generations
           WHERE user_id = ? AND result_key IN (${placeholders})
             AND thumb_key IS NOT NULL AND TRIM(thumb_key) != ''`,
        )
        .bind(userId, ...chunk)
        .all<{ result_key: string; thumb_key: string }>();
      for (const row of results ?? []) {
        if (row.result_key && row.thumb_key && !map.has(row.result_key)) {
          map.set(row.result_key, row.thumb_key);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("no such column") && !message.includes("no such table")) throw err;
    }
  }
  return map;
}

async function previewFor(
  env: Env,
  item: StoredGalleryItem,
  thumbs: Map<string, string>,
): Promise<GalleryPreviewJson> {
  const thumbKey = thumbs.get(item.key) ?? null;
  const previewKey = item.kind === "image" ? thumbKey || item.key : thumbKey;
  const thumbUrl = previewKey ? await displayStoredMediaUrl(env, previewKey, null) : null;
  return { kind: item.kind, name: item.name, thumbUrl };
}

export async function presentGallery(
  env: Env,
  userId: string,
  gallery: StoredGallery,
): Promise<{
  id: string;
  name: string;
  updatedAt: number;
  items: Array<StoredGalleryItem & { url: string; thumbUrl: string | null }>;
}> {
  const thumbs = await thumbKeyByResult(
    env.DB,
    userId,
    gallery.items.map((item) => item.key),
  );
  const items = await Promise.all(
    gallery.items.map(async (item) => {
      const preview = await previewFor(env, item, thumbs);
      return {
        ...item,
        url: (await displayStoredMediaUrl(env, item.key, null)) ?? "",
        thumbUrl: preview.thumbUrl,
      };
    }),
  );
  return { id: gallery.id, name: gallery.name, updatedAt: gallery.updatedAt, items };
}

export async function presentGalleryList(
  env: Env,
  userId: string,
  query: string,
): Promise<GalleryCardJson[]> {
  const profileId = await ensureDefaultProfile(env.DB, userId);
  const galleries = await listGalleries(env.DB, userId, query, profileId);
  const loaded = await Promise.all(
    galleries.map(async (gallery) => {
      const full = await getGallery(env.DB, userId, gallery.id);
      return { gallery, items: full?.items ?? [] };
    }),
  );
  const thumbs = await thumbKeyByResult(
    env.DB,
    userId,
    loaded.flatMap((entry) => entry.items.slice(0, PREVIEW_COUNT).map((item) => item.key)),
  );
  return Promise.all(
    loaded.map(async ({ gallery, items }) => ({
      id: gallery.id,
      name: gallery.name,
      updatedAt: gallery.updatedAt,
      count: items.length,
      previews: await Promise.all(
        items.slice(0, PREVIEW_COUNT).map((item) => previewFor(env, item, thumbs)),
      ),
    })),
  );
}
