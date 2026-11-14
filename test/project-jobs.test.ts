import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  acceptBasePrompt,
  acceptJobCost,
  groupJobRows,
  jobSettingsFromParams,
  jobStatus,
  type ProjectJobJson,
} from "../worker/job-record";
import { acceptJobRefs, jobRecordFromParams, listProjectJobs, projectJobStats } from "../worker/project-jobs";
import {
  acceptComposerDraft,
  acceptComposerSettings,
  defaultsFromJson,
  draftFromJson,
} from "../worker/project-draft";
import { paramsJsonForStorage } from "../worker/oxen";
import { createProject, deleteProject, getProject, listProjects, saveProjectDraft } from "../worker/projects";
import type { Env } from "../worker/types";
import {
  castFilesForJob,
  castMatchingJob,
  composerSettingsFromJob,
  composerStateForJob,
  filterJobs,
  jobModelLabel,
  jobPromptExcerpt,
  mergeJobOutputs,
  rerunBodyForJob,
} from "../src/lib/project-jobs";
import { flattenCast, type CastEntry } from "../src/lib/cast";
import type { Generation } from "../src/lib/api";

const USER = "u1";

function sqliteD1(files: string[]): { raw: DatabaseSync; db: D1Database; env: Env } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = OFF");
  for (const file of files) {
    raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
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
  const env = {
    DB: db,
    PUBLIC_BASE_URL: "https://studio.test",
    ENCRYPTION_KEY: "test-encryption-key",
    MEDIA_SIGNING_KEY: "test-signing-key",
  } as unknown as Env;
  return { raw, db, env };
}

const BASE_FILES = [
  "0001_init.sql",
  "0003_generation_batches.sql",
  "0004_generation_tags.sql",
  "0005_generation_thumbs.sql",
  "0009_galleries.sql",
  "0022_projects.sql",
  "0024_looks.sql",
  "0025_project_cast.sql",
  "0029_slots.sql",
];

const FILES = [...BASE_FILES, "0026_project_jobs.sql"];

function insertGeneration(
  raw: DatabaseSync,
  row: {
    id: string;
    batch?: string | null;
    project?: string | null;
    status?: string;
    createdAt: number;
    params?: Record<string, unknown>;
    prompt?: string;
    resultKey?: string | null;
    mediaType?: string;
  },
) {
  raw
    .prepare(
      `INSERT INTO generations (id, user_id, oxen_generation_id, mode, model, prompt, status, media_type, result_url,
         result_key, params_json, batch_id, project_id, created_at, updated_at)
       VALUES (?, ?, ?, 'text-to-image', 'bytedance/seedream-5-0', ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      USER,
      `ox-${row.id}`,
      row.prompt ?? "Look 1\n\nA quiet room",
      row.status ?? "succeeded",
      row.mediaType ?? "image",
      row.resultKey === undefined ? `u/${USER}/results/${row.id}.png` : row.resultKey,
      JSON.stringify(row.params ?? {}),
      row.batch ?? null,
      row.project ?? null,
      row.createdAt,
      row.createdAt,
    );
}

const refs = [
  { kind: "image", number: 1, role: "character", name: "lead.png", key: `u/${USER}/lead.png` },
  { kind: "image", number: 2, role: "background", name: "room.png", key: `u/${USER}/room.png` },
  { kind: "audio", number: 1, role: null, name: "voice.mp3", key: `u/${USER}/voice.mp3` },
];

const params = {
  model: "bytedance/seedream-5-0",
  prompt: "Look 1\n\nA quiet room with @Image1 and @Image2",
  aspect_ratio: "16:9",
  resolution: "2K",
  num_generations: 2,
  images: ["https://studio.test/media/lead", "https://studio.test/media/room"],
  studio_looks: [{ id: "l1", name: "Look 1" }],
  studio_refs: refs,
  studio_cost: 0.09,
  studio_prompt: "A quiet room with @Image1 and @Image2",
};

describe("job record on the generation row", () => {
  it("accepts the client's references for this user only and drops the rest", () => {
    const accepted = acceptJobRefs(USER, [
      ...refs,
      { kind: "image", number: 3, role: "object", name: "other", key: "u/someone-else/x.png" },
      { kind: "image", number: 0, name: "zero", key: `u/${USER}/zero.png` },
      { kind: "doc", number: 1, name: "doc", key: `u/${USER}/doc.pdf` },
      "junk",
    ]);
    expect(accepted).toEqual(refs);
    expect(acceptJobRefs(USER, "nope")).toEqual([]);
  });

  it("reads cost and base prompt strictly", () => {
    expect(acceptJobCost(0.123456)).toBe(0.1235);
    expect(acceptJobCost("0.5")).toBe(0.5);
    expect(acceptJobCost(-1)).toBeNull();
    expect(acceptJobCost(Number.NaN)).toBeNull();
    expect(acceptJobCost(null)).toBeNull();
    expect(acceptBasePrompt("  hi ")).toBe("hi");
    expect(acceptBasePrompt("")).toBeNull();
    expect(acceptBasePrompt("x".repeat(8001))).toBeNull();
  });

  it("survives storage, including the slimmed fallback for an oversized payload", () => {
    const stored = paramsJsonForStorage(params);
    expect(jobRecordFromParams(USER, stored)).toEqual({ refs, cost: 0.09, basePrompt: params.studio_prompt });
    expect(jobSettingsFromParams(stored)).toEqual({ aspect_ratio: "16:9", resolution: "2K", num_generations: 2 });
    const huge = paramsJsonForStorage({ ...params, prompt: "x".repeat(2_100_000) });
    expect(huge.length).toBeLessThan(2_000_000);
    expect(jobRecordFromParams(USER, huge)).toEqual({ refs, cost: 0.09, basePrompt: params.studio_prompt });
    expect(huge).not.toContain("data:");
    expect(jobRecordFromParams(USER, null)).toEqual({ refs: [], cost: null, basePrompt: null });
  });

  it("folds output statuses into one job status", () => {
    expect(jobStatus([])).toBe("queued");
    expect(jobStatus(["queued", "queued"])).toBe("queued");
    expect(jobStatus(["queued", "running"])).toBe("running");
    expect(jobStatus(["succeeded", "running"])).toBe("running");
    expect(jobStatus(["succeeded", "succeeded"])).toBe("succeeded");
    expect(jobStatus(["failed"])).toBe("failed");
    expect(jobStatus(["cancelled", "cancelled"])).toBe("cancelled");
    expect(jobStatus(["succeeded", "failed"])).toBe("partial");
  });

  it("groups rows by batch, newest batch first, outputs in creation order", () => {
    const rows = [
      { id: "b2", batch_id: "B", created_at: 20 },
      { id: "a1", batch_id: "A", created_at: 10 },
      { id: "solo", batch_id: null, created_at: 15 },
      { id: "b1", batch_id: "B", created_at: 19 },
    ];
    expect(groupJobRows(rows).map((group) => group.map((row) => row.id))).toEqual([["b1", "b2"], ["solo"], ["a1"]]);
  });
});

describe("jobs from the database", () => {
  it("lists a project's batches newest first with signed URLs, settings, refs, and tags", async () => {
    const { raw, env, db } = sqliteD1(FILES);
    const projectId = await createProject(db, USER, "p1", "Clip");
    insertGeneration(raw, { id: "g1", batch: "B1", project: projectId, createdAt: 100, params });
    insertGeneration(raw, { id: "g2", batch: "B1", project: projectId, createdAt: 101, params, status: "failed", resultKey: null });
    insertGeneration(raw, { id: "g3", batch: "B2", project: projectId, createdAt: 200, params: { ...params, num_generations: 1 } });
    insertGeneration(raw, { id: "other", batch: "B9", project: null, createdAt: 300, params });
    raw.prepare(`INSERT INTO generation_tags (generation_id, user_id, tag, created_at) VALUES ('g3', ?, 'hero', 1)`).run(USER);

    const jobs = await listProjectJobs(env, USER, projectId);
    expect(jobs.map((job) => job.batchId)).toEqual(["B2", "B1"]);
    const [latest, first] = jobs as [ProjectJobJson, ProjectJobJson];
    expect(latest.status).toBe("succeeded");
    expect(latest.outputs[0]?.tags).toEqual(["hero"]);
    expect(latest.outputs[0]?.resultUrl).toMatch(/^https:\/\/studio\.test\//);
    expect(latest.refs.map((ref) => `${ref.kind}${ref.number}`)).toEqual(["image1", "image2", "audio1"]);
    expect(latest.refs[0]?.url).toMatch(/^https:\/\/studio\.test\//);
    expect(latest.refs[0]?.role).toBe("character");
    expect(latest.looks).toEqual([{ id: "l1", name: "Look 1" }]);
    expect(latest.basePrompt).toBe(params.studio_prompt);
    expect(latest.cost).toBe(0.09);
    expect(latest.settings).toEqual({ aspect_ratio: "16:9", resolution: "2K", num_generations: 1 });
    expect(first.status).toBe("partial");
    expect(first.outputs.map((output) => output.id)).toEqual(["g1", "g2"]);

    const stats = await projectJobStats(db, USER, [projectId, "missing"]);
    expect(stats.get(projectId)).toEqual({ jobs: 2, lastRunAt: 200 });
    expect(stats.has("missing")).toBe(false);
    const summaries = await listProjects(db, USER, "p1");
    expect(summaries[0]).toMatchObject({ id: projectId, jobCount: 2, lastRunAt: 200 });
  });

  it("stores the draft and defaults on the project and unlinks runs when it is deleted", async () => {
    const { raw, env, db } = sqliteD1(FILES);
    const projectId = await createProject(db, USER, "p1", "Clip");
    const fresh = await getProject(env, USER, projectId);
    expect(fresh?.draft).toBeNull();
    expect(fresh?.defaults).toBeNull();

    const draft = {
      prompt: "A quiet room",
      mode: "text-to-image",
      model: "bytedance/seedream-5-0",
      settings: { aspectRatio: "16:9", resolution: "2K", safetyCheckerOn: false },
    };
    expect(await saveProjectDraft(db, USER, projectId, { draft, defaults: null })).toBe(true);
    expect(await saveProjectDraft(db, "someone-else", projectId, { draft, defaults: null })).toBe(false);
    const withDraft = await getProject(env, USER, projectId);
    expect(withDraft?.draft).toEqual(draft);
    expect(withDraft?.defaults).toBeNull();

    const defaults = { mode: "text-to-image", model: "bytedance/seedream-5-0", settings: { aspectRatio: "16:9" } };
    await saveProjectDraft(db, USER, projectId, { draft: null, defaults });
    const withDefaults = await getProject(env, USER, projectId);
    expect(withDefaults?.defaults).toEqual(defaults);
    expect(withDefaults?.draft).toEqual(draft);

    insertGeneration(raw, { id: "g1", batch: "B1", project: projectId, createdAt: 100, params });
    expect(await deleteProject(db, USER, projectId)).toBe(true);
    expect(raw.prepare(`SELECT project_id FROM generations WHERE id = 'g1'`).get()).toEqual({ project_id: null });
  });
});

describe("composer draft acceptance", () => {
  it("keeps known settings only, as short strings or booleans", () => {
    expect(
      acceptComposerSettings({
        aspectRatio: "16:9",
        duration: 5,
        generateAudio: true,
        seed: "x".repeat(65),
        bogus: "no",
        resolution: { nested: true },
      }),
    ).toEqual({ aspectRatio: "16:9", duration: "5", generateAudio: true });
    expect(acceptComposerDraft({ prompt: "p", mode: "text-to-image", model: "m", settings: {} })).toEqual({
      prompt: "p",
      mode: "text-to-image",
      model: "m",
      settings: {},
    });
    expect(acceptComposerDraft({ prompt: 1 })).toEqual({ prompt: null, mode: null, model: "", settings: {} });
    expect(acceptComposerDraft("text")).toBeNull();
    expect(draftFromJson("{}")).toBeNull();
    expect(draftFromJson(null)).toBeNull();
    expect(defaultsFromJson('{"mode":"text-to-video","model":"m","settings":{"duration":"5"}}')).toEqual({
      mode: "text-to-video",
      model: "m",
      settings: { duration: "5" },
    });
  });
});

describe("project migrations", () => {
  it("0026 adds the job columns and the project index", () => {
    const { raw } = sqliteD1(BASE_FILES);
    raw.exec(
      `INSERT INTO projects (id, user_id, profile_id, name, prompt, created_at, updated_at) VALUES ('pr1', 'u1', 'p1', 'Clip', 'Brief', 1, 1);
       INSERT INTO generations (id, user_id, oxen_generation_id, mode, model, status, created_at, updated_at)
         VALUES ('g1', 'u1', 'ox1', 'text-to-image', 'old/model', 'succeeded', 1, 1);`,
    );
    raw.exec(readFileSync(new URL("../migrations/0026_project_jobs.sql", import.meta.url), "utf8"));
    expect(raw.prepare(`SELECT project_id FROM generations WHERE id = 'g1'`).get()).toEqual({ project_id: null });
    expect(raw.prepare(`SELECT draft_json, defaults_json FROM projects WHERE id = 'pr1'`).get()).toEqual({
      draft_json: "{}",
      defaults_json: "{}",
    });
    expect(raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'generations_project_idx'`).get()).toEqual({
      name: "generations_project_idx",
    });
  });

  it("0027 drops the session table and its indexes, and projects keep working without them", async () => {
    const { raw, db, env } = sqliteD1([...BASE_FILES, "0026_project_jobs.sql"]);
    const before = raw.prepare(`SELECT name FROM sqlite_master WHERE name IN ('project_sessions', 'project_sessions_project_idx', 'generations_session_idx') ORDER BY name`).all();
    expect(before).toHaveLength(3);
    raw.exec(readFileSync(new URL("../migrations/0027_drop_project_sessions.sql", import.meta.url), "utf8"));
    const after = raw.prepare(`SELECT name FROM sqlite_master WHERE name IN ('project_sessions', 'project_sessions_project_idx', 'generations_session_idx')`).all();
    expect(after).toEqual([]);

    raw.exec(
      `INSERT INTO projects (id, user_id, profile_id, name, prompt, created_at, updated_at) VALUES ('pr1', 'u1', 'p1', 'Clip', 'Brief', 1, 1);
       INSERT INTO generations (id, user_id, oxen_generation_id, mode, model, status, project_id, created_at, updated_at)
         VALUES ('g1', 'u1', 'ox1', 'text-to-image', 'old/model', 'succeeded', 'pr1', 1, 1);`,
    );
    expect((await getProject(env, USER, "pr1"))?.jobCount).toBe(1);
    expect(await deleteProject(db, USER, "pr1")).toBe(true);
    expect(raw.prepare(`SELECT project_id FROM generations WHERE id = 'g1'`).get()).toEqual({ project_id: null });
  });
});

function job(overrides: Partial<ProjectJobJson> = {}): ProjectJobJson {
  return {
    batchId: "B1",
    projectId: "pr1",
    createdAt: 100,
    mode: "image-to-image",
    model: "bytedance/seedream-5-0",
    prompt: "Look 1\n\nA quiet room with @Image1",
    basePrompt: "A quiet room with @Image1",
    looks: [{ id: "l1", name: "Look 1" }],
    refs: [
      { ...refs[0]!, kind: "image", role: "character", url: "https://studio.test/lead", thumbUrl: "https://studio.test/lead" },
      { ...refs[1]!, kind: "image", role: "background", url: null, thumbUrl: null },
      { ...refs[2]!, kind: "audio", role: null, url: "https://studio.test/voice", thumbUrl: null },
    ],
    settings: {
      aspect_ratio: "16:9",
      resolution: "2K",
      num_generations: 3,
      disable_safety_checker: true,
      generate_audio: true,
      capture_last_frame: true,
      seed: 7,
    },
    multiPrompt: null,
    cost: 0.27,
    status: "succeeded",
    outputs: [
      {
        id: "g1",
        status: "succeeded",
        mediaType: "image",
        resultUrl: "https://studio.test/g1",
        resultKey: `u/${USER}/results/g1.png`,
        thumbUrl: null,
        errorMessage: null,
        createdAt: 100,
        updatedAt: 100,
        tags: [],
      },
      {
        id: "g2",
        status: "failed",
        mediaType: "image",
        resultUrl: null,
        resultKey: null,
        thumbUrl: null,
        errorMessage: "boom",
        createdAt: 101,
        updatedAt: 101,
        tags: [],
      },
      {
        id: "g3",
        status: "succeeded",
        mediaType: "video",
        resultUrl: "https://hub.example/g3.mp4",
        resultKey: null,
        thumbUrl: null,
        errorMessage: null,
        createdAt: 102,
        updatedAt: 102,
        tags: [],
      },
    ],
    ...overrides,
  };
}

describe("Re-run", () => {
  it("sends the same request through the queue with one output, leaving out references that are gone", () => {
    const plan = rerunBodyForJob(job());
    expect(plan.missing.map((ref) => ref.number)).toEqual([2]);
    expect(plan.body).toEqual({
      mode: "image-to-image",
      model: "bytedance/seedream-5-0",
      num_generations: 1,
      aspect_ratio: "16:9",
      resolution: "2K",
      disable_safety_checker: true,
      generate_audio: true,
      get_last_frame: true,
      seed: 7,
      prompt: "Look 1\n\nA quiet room with @Image1",
      looks: [{ id: "l1", name: "Look 1" }],
      project_id: "pr1",
      refs: refs,
      base_prompt: "A quiet room with @Image1",
      estimated_cost: 0.09,
      images: ["https://studio.test/lead"],
      image_roles: ["character"],
      audios: ["https://studio.test/voice"],
    });
    expect(JSON.stringify(plan.body)).not.toContain("data:");
  });

  it("keeps a multi-shot prompt and the cost of a single run", () => {
    const shots = [{ prompt: "one", duration: 5 }, { prompt: "two", duration: 5 }];
    const plan = rerunBodyForJob(job({ multiPrompt: shots, settings: { num_generations: 1 }, cost: 0.5, refs: [] }));
    expect(plan.body.multi_prompt).toEqual(shots);
    expect(plan.body.estimated_cost).toBe(0.5);
    expect(plan.body.refs).toBeUndefined();
    expect(plan.body.images).toBeUndefined();
  });
});

describe("Load into composer", () => {
  it("puts back the scene prompt, the looks, the model, and the settings under composer names", () => {
    const state = composerStateForJob(job());
    expect(state).toEqual({
      prompt: "A quiet room with @Image1",
      lookIds: ["l1"],
      mode: "image-to-image",
      model: "bytedance/seedream-5-0",
      settings: {
        aspectRatio: "16:9",
        resolution: "2K",
        seed: "7",
        generateAudio: true,
        getLastFrame: true,
        safetyCheckerOn: false,
      },
    });
    expect(composerSettingsFromJob({ enable_safety_checker: true, duration: 8, safety_tolerance: 6 })).toEqual({
      safetyCheckerOn: true,
      duration: "8",
      safetyTolerance: "6",
    });
    expect(composerStateForJob(job({ basePrompt: null })).prompt).toBe("Look 1\n\nA quiet room with @Image1");
  });

  it("switches cast items on when the run attached them and off when it did not", () => {
    const entries: CastEntry[] = [
      {
        type: "gallery",
        id: "g",
        name: "Faces",
        active: true,
        items: [
          { id: "i1", kind: "image", name: "lead.png", key: `u/${USER}/lead.png`, url: "x", thumbUrl: null, galleryRole: "character", roleOverride: null, active: false, excluded: false },
          { id: "i2", kind: "image", name: "extra.png", key: `u/${USER}/extra.png`, url: "x", thumbUrl: null, galleryRole: "character", roleOverride: null, active: true, excluded: false },
          { id: "i3", kind: "image", name: "gone.png", key: `u/${USER}/gone.png`, url: "x", thumbUrl: null, galleryRole: "character", roleOverride: null, active: true, excluded: true },
        ],
      },
      { type: "file", id: "f1", kind: "audio", name: "voice.mp3", key: `u/${USER}/voice.mp3`, url: "x", thumbUrl: null, role: null, active: false },
      { type: "file", id: "f2", kind: "image", name: "room.png", key: `u/${USER}/room.png`, url: "x", thumbUrl: null, role: "background", active: true },
    ];
    const matched = castMatchingJob(entries, flattenCast(entries), job().refs);
    expect(matched).not.toBeNull();
    const items = flattenCast(matched!);
    expect(items.map((item) => `${item.name}:${item.active ? "on" : "off"}`)).toEqual([
      "lead.png:on",
      "extra.png:off",
      "voice.mp3:on",
      "room.png:on",
    ]);
    expect(matched![0]).toMatchObject({ active: true });
    expect(castMatchingJob(entries, flattenCast(entries), [])).toBeNull();
    expect(
      castMatchingJob(entries, flattenCast(entries), [{ ...job().refs[0]!, key: `u/${USER}/nowhere.png` }]),
    ).toBeNull();
  });
});

describe("Add outputs to cast", () => {
  it("takes finished outputs that have a Studio copy, in order, as loose files", () => {
    const files = castFilesForJob(job(), job().outputs);
    expect(files).toEqual([
      {
        kind: "image",
        key: `u/${USER}/results/g1.png`,
        url: "https://studio.test/g1",
        name: expect.stringMatching(/\.png$/),
      },
    ]);
    const live = new Map<string, Generation>([
      [
        "g3",
        {
          id: "g3",
          status: "succeeded",
          mediaType: "video",
          resultUrl: "https://studio.test/g3",
          resultKey: `u/${USER}/results/g3.mp4`,
          updatedAt: 200,
        } as Generation,
      ],
    ]);
    const merged = mergeJobOutputs(job(), live);
    expect(merged[2]).toMatchObject({ resultKey: `u/${USER}/results/g3.mp4`, updatedAt: 200 });
    expect(castFilesForJob(job(), merged).map((file) => file.kind)).toEqual(["image", "video"]);
  });
});

describe("job list helpers", () => {
  it("filters by model and status and shortens the prompt for a row", () => {
    const jobs = [job(), job({ batchId: "B2", model: "fal-ai/flux-2", status: "running" }), job({ batchId: "B3", status: "partial" })];
    expect(filterJobs(jobs, { model: "fal-ai/flux-2", status: "" }).map((item) => item.batchId)).toEqual(["B2"]);
    expect(filterJobs(jobs, { model: "", status: "failed" }).map((item) => item.batchId)).toEqual(["B3"]);
    expect(filterJobs(jobs, { model: "", status: "running" }).map((item) => item.batchId)).toEqual(["B2"]);
    expect(filterJobs(jobs, { model: "", status: "done" }).map((item) => item.batchId)).toEqual(["B1"]);
    expect(jobPromptExcerpt(job(), 12)).toBe("A quiet roo…");
    expect(jobPromptExcerpt({ prompt: "  \n  ", basePrompt: null })).toBe("(no prompt)");
    expect(jobModelLabel("bytedance/seedance-2-5-reference-to-video")).toBe("Seedance 2.5 Reference To Video");
    expect(jobModelLabel("fal-ai/flux-2")).toBe("Flux 2");
  });
});
