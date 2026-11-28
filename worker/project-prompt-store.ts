import { draftFromJson } from "./project-draft";
import {
  acceptEveryScene,
  acceptProjectPromptBody,
  acceptProjectPromptName,
  canAddProjectPrompt,
  reorderedPromptIds,
  sortProjectPrompts,
  type ProjectPrompt,
} from "./project-prompts";

type PromptRow = {
  id: string;
  name: string;
  body: string;
  every_scene: number;
  position: number;
};

export type ProjectPromptFailure = "missing" | "invalid" | "limit";

function fromRow(row: PromptRow): ProjectPrompt {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    everyScene: Number(row.every_scene) === 1,
    position: Number(row.position) || 0,
  };
}

/** The project's prompts in list order. Callers check the project is the user's first. */
export async function listProjectPrompts(
  db: D1Database,
  userId: string,
  projectId: string,
): Promise<ProjectPrompt[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, body, every_scene, position FROM project_prompts
       WHERE project_id = ? AND user_id = ?
       ORDER BY position ASC, created_at ASC`,
    )
    .bind(projectId, userId)
    .all<PromptRow>();
  return sortProjectPrompts((results ?? []).map(fromRow));
}

export async function createProjectPrompt(
  db: D1Database,
  userId: string,
  projectId: string,
  input: { name?: unknown; body?: unknown; everyScene?: unknown },
): Promise<{ prompt: ProjectPrompt } | { error: ProjectPromptFailure }> {
  const name = acceptProjectPromptName(input.name);
  const body = acceptProjectPromptBody(input.body);
  const everyScene = input.everyScene === undefined ? false : acceptEveryScene(input.everyScene);
  if (!name || !body || everyScene == null) return { error: "invalid" };
  const existing = await listProjectPrompts(db, userId, projectId);
  if (!canAddProjectPrompt(existing.length)) return { error: "limit" };
  const position = existing.reduce((max, item) => Math.max(max, item.position + 1), 0);
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO project_prompts (id, project_id, user_id, name, body, every_scene, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, projectId, userId, name, body, everyScene ? 1 : 0, position, now, now)
    .run();
  return { prompt: { id, name, body, everyScene, position } };
}

export async function updateProjectPrompt(
  db: D1Database,
  userId: string,
  projectId: string,
  id: string,
  patch: { name?: unknown; body?: unknown; everyScene?: unknown },
): Promise<{ prompt: ProjectPrompt } | { error: ProjectPromptFailure }> {
  const row = await db
    .prepare(
      `SELECT id, name, body, every_scene, position FROM project_prompts
       WHERE id = ? AND project_id = ? AND user_id = ?`,
    )
    .bind(id, projectId, userId)
    .first<PromptRow>();
  if (!row) return { error: "missing" };
  const current = fromRow(row);
  const name = patch.name === undefined ? current.name : acceptProjectPromptName(patch.name);
  const body = patch.body === undefined ? current.body : acceptProjectPromptBody(patch.body);
  const everyScene = patch.everyScene === undefined ? current.everyScene : acceptEveryScene(patch.everyScene);
  if (!name || !body || everyScene == null) return { error: "invalid" };
  await db
    .prepare(
      `UPDATE project_prompts SET name = ?, body = ?, every_scene = ?, updated_at = ?
       WHERE id = ? AND project_id = ? AND user_id = ?`,
    )
    .bind(name, body, everyScene ? 1 : 0, Math.floor(Date.now() / 1000), id, projectId, userId)
    .run();
  return { prompt: { ...current, name, body, everyScene } };
}

export async function deleteProjectPrompt(
  db: D1Database,
  userId: string,
  projectId: string,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM project_prompts WHERE id = ? AND project_id = ? AND user_id = ?`)
    .bind(id, projectId, userId)
    .run();
  if ((result.meta.changes ?? 0) === 0) return false;
  // The prompt also drops out of the job in progress.
  const row = await db
    .prepare(`SELECT draft_json FROM projects WHERE id = ? AND user_id = ?`)
    .bind(projectId, userId)
    .first<{ draft_json: string | null }>();
  const draft = draftFromJson(row?.draft_json);
  if (draft?.promptIds?.includes(id)) {
    draft.promptIds = draft.promptIds.filter((item) => item !== id);
    await db
      .prepare(`UPDATE projects SET draft_json = ? WHERE id = ? AND user_id = ?`)
      .bind(JSON.stringify(draft), projectId, userId)
      .run();
  }
  return true;
}

/** Store a new list order and return the prompts in it. */
export async function reorderProjectPrompts(
  db: D1Database,
  userId: string,
  projectId: string,
  ids: readonly string[],
): Promise<ProjectPrompt[]> {
  const prompts = await listProjectPrompts(db, userId, projectId);
  const order = reorderedPromptIds(ids, prompts);
  if (order.length > 0) {
    await db.batch(
      order.map((id, position) =>
        db
          .prepare(`UPDATE project_prompts SET position = ? WHERE id = ? AND project_id = ? AND user_id = ?`)
          .bind(position, id, projectId, userId),
      ),
    );
  }
  const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]));
  return order.flatMap((id, position) => {
    const prompt = byId.get(id);
    return prompt ? [{ ...prompt, position }] : [];
  });
}
