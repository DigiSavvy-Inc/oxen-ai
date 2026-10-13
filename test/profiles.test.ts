import { describe, expect, it } from "vitest";
import {
  acceptProfileName,
  activateProfile,
  createProfile,
  deleteProfile,
  ensureDefaultProfile,
  renameProfile,
} from "../worker/profiles";

type ProfileRow = {
  id: string;
  user_id: string;
  name: string;
  created_at: number;
  updated_at: number;
};

type MediaRow = { id: string; user_id: string; profile_id: string | null };

function profileDb() {
  const profiles: ProfileRow[] = [];
  const generations: MediaRow[] = [];
  const galleries: MediaRow[] = [];
  let active: string | null = null;
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async all() {
              if (sql.includes("FROM profiles")) {
                return {
                  results: profiles
                    .filter((row) => row.user_id === args[0])
                    .sort((a, b) => a.created_at - b.created_at)
                    .map((row) => ({
                      id: row.id,
                      name: row.name,
                      created_at: row.created_at,
                      updated_at: row.updated_at,
                    })),
                };
              }
              return { results: [] };
            },
            async first() {
              if (sql.includes("active_profile_id")) return { active_profile_id: active };
              return null;
            },
            async run() {
              if (sql.includes("INSERT INTO profiles")) {
                profiles.push({
                  id: String(args[0]),
                  user_id: String(args[1]),
                  name: String(args[2]),
                  created_at: Number(args[3]),
                  updated_at: Number(args[4]),
                });
              } else if (sql.includes("UPDATE profiles SET name")) {
                const row = profiles.find((item) => item.id === args[2] && item.user_id === args[3]);
                if (!row) return { success: true, meta: { changes: 0 } };
                row.name = String(args[0]);
                row.updated_at = Number(args[1]);
                return { success: true, meta: { changes: 1 } };
              } else if (sql.includes("UPDATE generations SET profile_id") && sql.includes("IS NULL")) {
                for (const row of generations) {
                  if (row.user_id === args[1] && row.profile_id == null) row.profile_id = String(args[0]);
                }
              } else if (sql.includes("UPDATE galleries SET profile_id") && sql.includes("IS NULL")) {
                for (const row of galleries) {
                  if (row.user_id === args[1] && row.profile_id == null) row.profile_id = String(args[0]);
                }
              } else if (sql.includes("UPDATE generations SET profile_id")) {
                for (const row of generations) {
                  if (row.user_id === args[1] && row.profile_id === args[2]) row.profile_id = String(args[0]);
                }
              } else if (sql.includes("UPDATE galleries SET profile_id")) {
                for (const row of galleries) {
                  if (row.user_id === args[1] && row.profile_id === args[2]) row.profile_id = String(args[0]);
                }
              } else if (sql.includes("DELETE FROM profiles")) {
                const index = profiles.findIndex((row) => row.id === args[0] && row.user_id === args[1]);
                if (index >= 0) profiles.splice(index, 1);
              } else if (sql.includes("active_profile_id")) {
                active = String(args[0]);
                return { success: true, meta: { changes: 1 } };
              }
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return { profiles, generations, galleries, db: db as unknown as D1Database, active: () => active };
}

describe("profiles", () => {
  it("rejects a blank name", () => {
    expect(acceptProfileName("  Work  ")).toBe("Work");
    expect(acceptProfileName("   ")).toBeNull();
  });

  it("starts on Personal, then switches and keeps media with the profile", async () => {
    const store = profileDb();
    store.generations.push({ id: "gen-1", user_id: "user-1", profile_id: null });
    store.galleries.push({ id: "gal-1", user_id: "user-1", profile_id: null });
    const personal = await ensureDefaultProfile(store.db, "user-1");
    expect(personal).toBeTruthy();
    expect(store.profiles.map((row) => row.name)).toEqual(["Personal"]);
    expect(store.generations[0]?.profile_id).toBe(personal);
    expect(store.galleries[0]?.profile_id).toBe(personal);
    expect(await ensureDefaultProfile(store.db, "user-1")).toBe(personal);

    const created = await createProfile(store.db, "user-1", "Work");
    expect("error" in created).toBe(false);
    if ("error" in created) return;
    expect(created.activeId).not.toBe(personal);
    expect(created.profiles.map((profile) => profile.name)).toEqual(["Personal", "Work"]);
    expect(store.generations[0]?.profile_id).toBe(personal);

    const back = await activateProfile(store.db, "user-1", personal!);
    expect("activeId" in back && back.activeId).toBe(personal);
    const renamed = await renameProfile(store.db, "user-1", created.activeId, "Client");
    expect("profiles" in renamed && renamed.profiles.some((profile) => profile.name === "Client")).toBe(true);

    const removed = await deleteProfile(store.db, "user-1", created.activeId);
    expect("error" in removed).toBe(false);
    if ("error" in removed) return;
    expect(removed.profiles.map((profile) => profile.name)).toEqual(["Personal"]);
    expect(removed.activeId).toBe(personal);
    expect(await deleteProfile(store.db, "user-1", personal!)).toEqual({ error: "last" });
  });

  it("folds a second Personal created in the same moment back into the active one", async () => {
    const store = profileDb();
    const personal = await ensureDefaultProfile(store.db, "user-1");
    const createdAt = store.profiles[0]?.created_at ?? 0;
    store.profiles.push({
      id: "dup",
      user_id: "user-1",
      name: "Personal",
      created_at: createdAt,
      updated_at: createdAt,
    });
    store.galleries.push({ id: "gal-dup", user_id: "user-1", profile_id: "dup" });
    expect(await ensureDefaultProfile(store.db, "user-1")).toBe(personal);
    expect(store.profiles.map((row) => row.id)).toEqual([personal]);
    expect(store.galleries[0]?.profile_id).toBe(personal);
  });
});
