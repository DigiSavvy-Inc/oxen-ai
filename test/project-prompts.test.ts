import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  acceptAppliedPrompts,
  acceptProjectPromptBody,
  acceptProjectPromptName,
  acceptPromptIds,
  canAddProjectPrompt,
  everySceneCounts,
  everyScenePromptIds,
  filterProjectPrompts,
  joinProjectPrompts,
  livePromptIds,
  onProjectPrompts,
  PROJECT_PROMPT_MAX,
  PROJECT_PROMPT_NAME_MAX,
  PROJECT_PROMPTS_MAX,
  promptFirstLine,
  promptPlanText,
  promptsFromParams,
  reorderedPromptIds,
  togglePromptId,
  type ProjectPrompt,
} from "../worker/project-prompts";
import {
  createProjectPrompt,
  deleteProjectPrompt,
  listProjectPrompts,
  reorderProjectPrompts,
  updateProjectPrompt,
} from "../worker/project-prompt-store";
import { SAVED_PROMPT_NAME_MAX } from "../worker/saved-prompts";
import { PROJECT_PROMPT_MAX as BRIEF_PROMPT_MAX, createProject, deleteProject, getProject, saveProjectDraft } from "../worker/projects";
import { acceptComposerDraft, draftFromJson } from "../worker/project-draft";
import { paramsJsonForStorage } from "../worker/oxen";
import { joinLooks } from "../worker/looks";
import { deliveryForRun } from "../src/lib/model-prompt";
import { composerStateForNewJob, composerStateOnOpen } from "../src/lib/project-model";
import { composerStateForJob } from "../src/lib/project-jobs";
import { expandNameText, planNameAttachments, type NameCatalogGallery } from "../src/lib/name-mentions";
import type { ProjectJob } from "../src/lib/api";
import type { Env } from "../worker/types";

const USER = "u1";

function pp(id: string, position: number, everyScene: boolean, body = `${id} body.`): ProjectPrompt {
  return { id, name: id.toUpperCase(), body, everyScene, position };
}

// List order is by position, not by id or by group.
const PROMPTS = [pp("rules", 1, true, "Keep the camera locked off."), pp("cast", 0, true, "Maya is 30."), pp("rain", 2, false, "Light rain.")];

describe("project prompt acceptance", () => {
  it("trims a name and rejects a blank or too-long one, with the saved prompt limit", () => {
    expect(PROJECT_PROMPT_NAME_MAX).toBe(SAVED_PROMPT_NAME_MAX);
    expect(acceptProjectPromptName("  House rules ")).toBe("House rules");
    expect(acceptProjectPromptName("   ")).toBeNull();
    expect(acceptProjectPromptName(7)).toBeNull();
    expect(acceptProjectPromptName("x".repeat(PROJECT_PROMPT_NAME_MAX))).toHaveLength(PROJECT_PROMPT_NAME_MAX);
    expect(acceptProjectPromptName("x".repeat(PROJECT_PROMPT_NAME_MAX + 1))).toBeNull();
  });

  it("keeps a body exactly, mention tokens and spacing included, up to the brief prompt limit", () => {
    expect(PROJECT_PROMPT_MAX).toBe(BRIEF_PROMPT_MAX);
    const body = "  @Image1 wears the coat from @Maya.wide\n\nand stays still. ";
    expect(acceptProjectPromptBody(body)).toBe(body);
    expect(acceptProjectPromptBody(" \n ")).toBeNull();
    expect(acceptProjectPromptBody(null)).toBeNull();
    expect(acceptProjectPromptBody("x".repeat(PROJECT_PROMPT_MAX))).toHaveLength(PROJECT_PROMPT_MAX);
    expect(acceptProjectPromptBody("x".repeat(PROJECT_PROMPT_MAX + 1))).toBeNull();
  });

  it("caps a project at 50 prompts", () => {
    expect(PROJECT_PROMPTS_MAX).toBe(50);
    expect(canAddProjectPrompt(49)).toBe(true);
    expect(canAddProjectPrompt(50)).toBe(false);
    const ids = Array.from({ length: 60 }, (_, index) => `p${index}`);
    expect(acceptPromptIds(ids)).toHaveLength(50);
    expect(acceptPromptIds(["a", "a", "", 3, "b"])).toEqual(["a", "b"]);
    expect(acceptPromptIds("a")).toBeNull();
    expect(acceptPromptIds(undefined)).toEqual([]);
  });
});

describe("what the model receives", () => {
  it("puts looks first, then the on prompts in list order, then the scene, and leaves an off prompt out", () => {
    const on = onProjectPrompts(["rules", "cast"], PROMPTS);
    expect(on.map((item) => item.id)).toEqual(["cast", "rules"]);
    const delivery = deliveryForRun({
      prompt: "She opens the door.",
      lookBlock: joinLooks([{ body: "Shot on 35mm" }]),
      promptBlock: joinProjectPrompts(on),
      attachments: [],
      routedKinds: [],
      faceFirst: false,
    });
    expect(delivery.prompt).toBe("Shot on 35mm.\n\nMaya is 30.\n\nKeep the camera locked off.\n\nShe opens the door.");
    expect(delivery.prompt).not.toContain("Light rain.");
  });

  it("sends the prompts alone when the scene is empty, and changes nothing with none on", () => {
    const block = joinProjectPrompts(onProjectPrompts(["rain"], PROMPTS));
    const onlyPrompts = deliveryForRun({ prompt: "", lookBlock: "", promptBlock: block, attachments: [], routedKinds: [], faceFirst: false });
    expect(onlyPrompts.prompt).toBe("Light rain.");
    const none = deliveryForRun({ prompt: "Hold still.", lookBlock: "", promptBlock: "", attachments: [], routedKinds: [], faceFirst: false });
    expect(none.prompt).toBe("Hold still.");
  });

  it("resolves a gallery name inside a project prompt with the scene's names, numbering each file once", () => {
    const maya: NameCatalogGallery = {
      id: "maya",
      name: "Maya",
      handle: "Maya",
      take: 1,
      items: [{ key: "face", kind: "image", name: "face.png", role: "character", label: null, url: "https://s.test/face", thumbUrl: null }],
    };
    const loft: NameCatalogGallery = {
      id: "loft",
      name: "Loft",
      handle: "Loft",
      take: 1,
      items: [{ key: "floor", kind: "image", name: "floor.png", role: "background", label: null, url: "https://s.test/floor", thumbUrl: null }],
    };
    const scene = "@Maya walks in.";
    const block = "Always set in @Loft, and @Maya never smiles.";
    const plan = planNameAttachments({
      prompt: promptPlanText(scene, block),
      galleries: [maya, loft],
      hand: [],
      caps: { image: 4, video: 0, audio: 0 },
    });
    expect(plan.files.map((file) => [file.name, file.number])).toEqual([
      ["face.png", 1],
      ["floor.png", 2],
    ]);
    expect(plan.unresolved).toEqual([]);
    expect(expandNameText(scene, plan.kept, plan.removed)).toBe("@Image1 walks in.");
    expect(expandNameText(block, plan.kept, plan.removed)).toBe("Always set in @Image2, and @Image1 never smiles.");
    // A name the profile does not have is flagged, so Generate holds instead of sending it raw.
    const missing = planNameAttachments({ prompt: promptPlanText(scene, "@Ghost stays."), galleries: [maya], hand: [], caps: { image: 4, video: 0, audio: 0 } });
    expect(missing.unresolved.map((mention) => mention.token)).toEqual(["@Ghost"]);
    expect(missing.unresolved[0]!.start).toBeGreaterThanOrEqual(scene.length);
  });
});

describe("the on set for a job", () => {
  it("New job resets to the Every scene prompts, whatever the draft had on", () => {
    const project = {
      prompt: "brief",
      lookIds: [],
      defaults: null,
      prompts: PROMPTS,
      draft: { prompt: "scene", mode: null, model: "", settings: {}, promptIds: ["rain"] },
    };
    expect(composerStateForNewJob(project).promptIds).toEqual(["cast", "rules"]);
    expect(composerStateOnOpen(project).promptIds).toEqual(["rain"]);
  });

  it("drops a prompt deleted from the project out of a draft and out of Load into composer", () => {
    const remaining = PROMPTS.filter((item) => item.id !== "rules");
    const project = {
      prompt: "brief",
      lookIds: [],
      defaults: null,
      prompts: remaining,
      draft: { prompt: "scene", mode: null, model: "", settings: {}, promptIds: ["rules", "rain"] },
    };
    expect(composerStateOnOpen(project).promptIds).toEqual(["rain"]);
    const job = { prompts: [{ id: "rules", name: "RULES" }, { id: "cast", name: "CAST" }] } as unknown as ProjectJob;
    const loaded = composerStateForJob({ ...job, basePrompt: null, prompt: "p", looks: [], settings: {} } as ProjectJob);
    expect(loaded.promptIds).toEqual(["rules", "cast"]);
    expect(livePromptIds(loaded.promptIds, remaining)).toEqual(["cast"]);
  });

  it("reads a draft saved before project prompts as the Every scene set", () => {
    expect(acceptComposerDraft({ prompt: "p", mode: null, model: "", settings: {} })?.promptIds).toBeUndefined();
    expect(livePromptIds(undefined, PROMPTS)).toEqual(["cast", "rules"]);
    expect(acceptComposerDraft({ prompt: "p", settings: {}, promptIds: ["a", "a", "b"] })?.promptIds).toEqual(["a", "b"]);
    expect(draftFromJson(JSON.stringify({ promptIds: [] }))?.promptIds).toEqual([]);
  });

  it("switches one for this job and counts the Every scene ones that are on", () => {
    const off = togglePromptId(["cast", "rules"], "rules", PROMPTS);
    expect(off).toEqual(["cast"]);
    expect(everySceneCounts(off, PROMPTS)).toEqual({ on: 1, total: 2 });
    expect(togglePromptId(off, "rain", PROMPTS)).toEqual(["cast", "rain"]);
    expect(everyScenePromptIds(PROMPTS)).toEqual(["cast", "rules"]);
  });

  it("filters by name or text, and shows the first line for a row", () => {
    expect(filterProjectPrompts(PROMPTS, "camera").map((item) => item.id)).toEqual(["rules"]);
    expect(filterProjectPrompts(PROMPTS, "rain").map((item) => item.id)).toEqual(["rain"]);
    expect(promptFirstLine("\n  First line \nSecond")).toBe("First line");
  });

  it("reorders known ids and keeps the rest after them", () => {
    expect(reorderedPromptIds(["rain", "nope", "rain"], PROMPTS)).toEqual(["rain", "cast", "rules"]);
  });
});

describe("studio_prompts on a run", () => {
  it("keeps ids and names only, and survives the stored params including the slimmed fallback", () => {
    expect(
      acceptAppliedPrompts([{ id: "a", name: "A", body: "secret" }, { id: "a", name: "Dup" }, { id: "b", name: "" }, "junk"]),
    ).toEqual([{ id: "a", name: "A" }]);
    const prompts = [{ id: "a", name: "House rules" }];
    const json = paramsJsonForStorage({ model: "m", prompt: "p", studio_prompts: prompts });
    expect(promptsFromParams(json)).toEqual(prompts);
    const huge = paramsJsonForStorage({ model: "m", prompt: "x".repeat(2_100_000), studio_prompts: prompts });
    expect(promptsFromParams(huge)).toEqual(prompts);
    expect(promptsFromParams(null)).toEqual([]);
    expect(promptsFromParams("{not json")).toEqual([]);
  });
});

describe("project prompt storage", () => {
  const FILES = [
    "0001_init.sql",
    "0003_generation_batches.sql",
    "0004_generation_tags.sql",
    "0005_generation_thumbs.sql",
    "0009_galleries.sql",
    "0022_projects.sql",
    "0024_looks.sql",
    "0025_project_cast.sql",
    "0029_slots.sql",
    "0026_project_jobs.sql",
    "0034_project_prompts.sql",
  ];

  function sqliteD1(): { raw: DatabaseSync; db: D1Database; env: Env } {
    const raw = new DatabaseSync(":memory:");
    raw.exec("PRAGMA foreign_keys = OFF");
    for (const file of FILES) raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    const statement = (sql: string, args: unknown[]) => ({
      async first() {
        return raw.prepare(sql).get(...(args as (string | number | null)[])) ?? null;
      },
      async all() {
        return { results: raw.prepare(sql).all(...(args as (string | number | null)[])) };
      },
      async run() {
        const info = raw.prepare(sql).run(...(args as (string | number | null)[]));
        return { success: true, meta: { changes: Number(info.changes) } };
      },
    });
    const db = {
      prepare(sql: string) {
        return { bind: (...args: unknown[]) => statement(sql, args), ...statement(sql, []) };
      },
      async batch(statements: { run(): Promise<unknown> }[]) {
        for (const item of statements) await item.run();
        return [];
      },
    } as unknown as D1Database;
    return { raw, db, env: { DB: db, PUBLIC_BASE_URL: "https://studio.test" } as unknown as Env };
  }

  it("creates, edits, reorders, lists on the project, and refuses the 51st", async () => {
    const { db, env } = sqliteD1();
    const projectId = await createProject(db, USER, "p1", "Film");
    const first = await createProjectPrompt(db, USER, projectId, { name: "Rules", body: "@Image1 stays.", everyScene: true });
    const second = await createProjectPrompt(db, USER, projectId, { name: "Rain", body: "Light rain." });
    if (!("prompt" in first) || !("prompt" in second)) throw new Error("not created");
    expect(second.prompt).toMatchObject({ everyScene: false, position: 1 });
    expect(await createProjectPrompt(db, USER, projectId, { name: " ", body: "x" })).toEqual({ error: "invalid" });

    const edited = await updateProjectPrompt(db, USER, projectId, second.prompt.id, { everyScene: true, name: "Rain, light" });
    expect(edited).toMatchObject({ prompt: { name: "Rain, light", everyScene: true, body: "Light rain." } });
    expect(await updateProjectPrompt(db, "someone-else", projectId, second.prompt.id, { name: "x" })).toEqual({ error: "missing" });

    const order = await reorderProjectPrompts(db, USER, projectId, [second.prompt.id]);
    expect(order.map((item) => item.id)).toEqual([second.prompt.id, first.prompt.id]);
    const project = await getProject(env, USER, projectId);
    expect(project?.prompts.map((item) => item.name)).toEqual(["Rain, light", "Rules"]);

    for (let index = 2; index < PROJECT_PROMPTS_MAX; index += 1) {
      await createProjectPrompt(db, USER, projectId, { name: `P${index}`, body: "text" });
    }
    expect(await listProjectPrompts(db, USER, projectId)).toHaveLength(PROJECT_PROMPTS_MAX);
    expect(await createProjectPrompt(db, USER, projectId, { name: "One more", body: "text" })).toEqual({ error: "limit" });
  });

  it("drops a deleted prompt from the stored draft, and deleting the project deletes its prompts", async () => {
    const { raw, db, env } = sqliteD1();
    const projectId = await createProject(db, USER, "p1", "Film");
    const kept = await createProjectPrompt(db, USER, projectId, { name: "Kept", body: "Kept." });
    const gone = await createProjectPrompt(db, USER, projectId, { name: "Gone", body: "Gone." });
    if (!("prompt" in kept) || !("prompt" in gone)) throw new Error("not created");
    const draft = { prompt: "scene", mode: null, model: "", settings: {}, promptIds: [kept.prompt.id, gone.prompt.id] };
    await saveProjectDraft(db, USER, projectId, { draft, defaults: null });

    expect(await deleteProjectPrompt(db, USER, projectId, gone.prompt.id)).toBe(true);
    expect(await deleteProjectPrompt(db, USER, projectId, gone.prompt.id)).toBe(false);
    expect((await getProject(env, USER, projectId))?.draft?.promptIds).toEqual([kept.prompt.id]);

    expect(await deleteProject(db, USER, projectId)).toBe(true);
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM project_prompts`).get()).toEqual({ n: 0 });
  });

  it("reads a project with no prompts table yet as a project with no prompts", async () => {
    const { raw, db, env } = sqliteD1();
    const projectId = await createProject(db, USER, "p1", "Film");
    raw.exec("DROP TABLE project_prompts");
    expect((await getProject(env, USER, projectId))?.prompts).toEqual([]);
  });
});
