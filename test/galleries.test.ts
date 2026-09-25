import { describe, expect, it } from "vitest";
import { app } from "../worker/index";
import { SESSION_COOKIE } from "../worker/auth";
import {
  acceptGalleryItems,
  acceptGalleryName,
  galleryKeyForUser,
  getGallery,
  listGalleries,
  saveGallery,
} from "../worker/galleries";
import { planGalleryAttach } from "../src/lib/gallery-attach";
import { insertAttachMentions, promptContainsToken } from "../src/lib/mentions";
import { createEnv, TEST_SESSION_ID, TEST_USER } from "./helpers";

type GalleryRow = {
  id: string;
  user_id: string;
  name: string;
  created_at: number;
  updated_at: number;
};

type ItemRow = {
  id: string;
  gallery_id: string;
  user_id: string;
  kind: string;
  name: string;
  media_key: string;
  position: number;
};

function galleriesDb() {
  const galleries: GalleryRow[] = [];
  const items: ItemRow[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async all() {
              if (sql.includes("FROM galleries")) {
                const userId = String(args[0]);
                let matched = galleries.filter((row) => row.user_id === userId);
                if (sql.includes("LIKE")) {
                  const needle = String(args[1]).replace(/^%/, "").replace(/%$/, "").toLowerCase();
                  matched = matched.filter((row) => row.name.toLowerCase().includes(needle));
                }
                matched.sort((a, b) => b.updated_at - a.updated_at);
                if (sql.includes("SELECT id FROM galleries")) {
                  return { results: matched.map((row) => ({ id: row.id })) };
                }
                return {
                  results: matched.map((row) => ({
                    id: row.id,
                    name: row.name,
                    updated_at: row.updated_at,
                  })),
                };
              }
              if (sql.includes("FROM gallery_items")) {
                const galleryId = String(args[0]);
                const userId = String(args[1]);
                return {
                  results: items
                    .filter((row) => row.gallery_id === galleryId && row.user_id === userId)
                    .sort((a, b) => a.position - b.position)
                    .map((row) => ({
                      id: row.id,
                      kind: row.kind,
                      name: row.name,
                      media_key: row.media_key,
                      position: row.position,
                    })),
                };
              }
              return { results: [] };
            },
            async first() {
              if (sql.includes("FROM sessions")) {
                return args[0] === TEST_SESSION_ID ? TEST_USER : null;
              }
              if (sql.includes("FROM galleries")) {
                return (
                  galleries.find((row) => row.id === args[0] && row.user_id === args[1]) ?? null
                );
              }
              return null;
            },
            async run() {
              if (sql.includes("INSERT INTO galleries")) {
                galleries.push({
                  id: String(args[0]),
                  user_id: String(args[1]),
                  name: String(args[2]),
                  created_at: Number(args[3]),
                  updated_at: Number(args[4]),
                });
              } else if (sql.includes("UPDATE galleries")) {
                const row = galleries.find((item) => item.id === args[2] && item.user_id === args[3]);
                if (row) {
                  row.name = String(args[0]);
                  row.updated_at = Number(args[1]);
                }
              } else if (sql.includes("INSERT INTO gallery_items")) {
                items.push({
                  id: String(args[0]),
                  gallery_id: String(args[1]),
                  user_id: String(args[2]),
                  kind: String(args[3]),
                  name: String(args[4]),
                  media_key: String(args[5]),
                  position: Number(args[6]),
                });
              } else if (sql.includes("DELETE FROM gallery_items")) {
                const galleryId = String(args[0]);
                const userId = String(args[1]);
                for (let index = items.length - 1; index >= 0; index -= 1) {
                  const row = items[index];
                  if (row && row.gallery_id === galleryId && row.user_id === userId) items.splice(index, 1);
                }
              } else if (sql.includes("DELETE FROM galleries")) {
                const index = galleries.findIndex((row) => row.id === args[0] && row.user_id === args[1]);
                if (index >= 0) galleries.splice(index, 1);
              }
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { galleries, items, db: db as unknown as D1Database };
}

describe("galleries", () => {
  it("rejects a blank name and another user's media key", () => {
    expect(acceptGalleryName("  Product shots  ")).toBe("Product shots");
    expect(acceptGalleryName("   ")).toBeNull();
    expect(galleryKeyForUser("user-1", "u/user-1/galleries/a.png")).toBe("u/user-1/galleries/a.png");
    expect(galleryKeyForUser("user-1", "u/user-2/galleries/a.png")).toBeNull();
    expect(galleryKeyForUser("user-1", "u/user-1/../user-2/a.png")).toBeNull();
    expect(
      acceptGalleryItems("user-1", [
        { kind: "image", name: "hero.png", key: "u/user-1/galleries/a.png" },
        { kind: "audio", name: "bed.mp3", key: "u/someone/galleries/b.mp3" },
      ]),
    ).toBeNull();
  });

  it("stores a gallery for the signed-in user and loads it back in order", async () => {
    const { db } = galleriesDb();
    const saved = await saveGallery(db, TEST_USER.id, {
      name: "Product shots",
      items: [
        { kind: "image", name: "hero.png", key: "u/user-1/galleries/hero.png" },
        { kind: "video", name: "clip.mp4", key: "u/user-1/galleries/clip.mp4" },
      ],
    });
    expect(saved?.name).toBe("Product shots");
    await saveGallery(db, "someone-else", {
      name: "Product shots",
      items: [{ kind: "image", name: "other.png", key: "u/someone-else/galleries/other.png" }],
    });
    const mine = await listGalleries(db, TEST_USER.id, "product");
    expect(mine.map((item) => item.name)).toEqual(["Product shots"]);
    const loaded = await getGallery(db, TEST_USER.id, saved!.id);
    expect(loaded?.items.map((item) => item.name)).toEqual(["hero.png", "clip.mp4"]);
    expect(await getGallery(db, "someone-else", saved!.id)).toBeNull();
    const renamed = await saveGallery(db, TEST_USER.id, {
      id: saved!.id,
      name: "Launch",
      items: [{ kind: "audio", name: "bed.mp3", key: "u/user-1/galleries/bed.mp3" }],
    });
    expect(renamed?.items.map((item) => item.kind)).toEqual(["audio"]);
    expect(await listGalleries(db, TEST_USER.id, "launch")).toHaveLength(1);
  });

  it("requires a signed-in user on the gallery routes", async () => {
    const res = await app.request("https://studio.digisavvy.dev/api/galleries", {}, createEnv());
    expect(res.status).toBe(401);
    const authed = await app.request(
      "https://studio.digisavvy.dev/api/galleries",
      {
        method: "POST",
        headers: {
          Cookie: `${SESSION_COOKIE}=${TEST_SESSION_ID}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "   ", items: [] }),
      },
      createEnv(),
    );
    expect(authed.status).toBe(400);
  });
});

describe("gallery attach", () => {
  const image = {
    kind: "image" as const,
    name: "hero.png",
    key: "u/user-1/galleries/hero.png",
    url: "https://studio.example/hero.png",
  };
  const audio = {
    kind: "audio" as const,
    name: "bed.mp3",
    key: "u/user-1/galleries/bed.mp3",
    url: "https://studio.example/bed.mp3",
  };

  it("adds accepted media as mentions and names what the model skips", () => {
    const plan = planGalleryAttach({
      items: [image, audio],
      staged: [],
      caps: { image: 2, video: 0, audio: 0 },
      prompt: "wide shot",
      faceFirst: false,
    });
    expect(plan.add.map((item) => item.name)).toEqual(["hero.png"]);
    expect(plan.tokens).toEqual(["@Image1"]);
    expect(plan.skipped.map((item) => item.name)).toEqual(["bed.mp3"]);
    const placed = insertAttachMentions("wide shot", 4, plan.tokens);
    expect(placed.next).toBe("wide @Image1 shot");
    expect(placed.caret).toBe("wide @Image1 ".length);
  });

  it("does not insert a mention that is already in the prompt", () => {
    const plan = planGalleryAttach({
      items: [image],
      staged: [],
      caps: { image: 2, video: 0, audio: 0 },
      prompt: "use @Image1 again",
      faceFirst: false,
    });
    expect(plan.add).toHaveLength(1);
    expect(plan.tokens).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(promptContainsToken("see @Image10", "@Image1")).toBe(false);
    expect(promptContainsToken("see @Image1", "@Image1")).toBe(true);
    expect(insertAttachMentions("see @Image10", null, ["@Image1"]).next).toBe("see @Image10 @Image1 ");
  });

  it("does not attach the same media twice", () => {
    const plan = planGalleryAttach({
      items: [image],
      staged: [{ ...image, role: "character" }],
      caps: { image: 4, video: 1, audio: 1 },
      prompt: "hold @Image1",
      faceFirst: false,
    });
    expect(plan.add).toEqual([]);
    expect(plan.tokens).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });
});
