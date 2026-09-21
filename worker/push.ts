import { buildPushPayload } from "@block65/webcrypto-web-push";
import {
  generationNotifyCopy,
  isTerminalNotifyStatus,
  shouldNotifyStatusChange,
  type GenerationNotifyInput,
} from "./notify-copy";
import type { Env } from "./types";

export type PushSubscriptionRecord = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: number;
  updated_at: number;
};

export type PushSubscriptionInput = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export { generationNotifyCopy, isTerminalNotifyStatus, shouldNotifyStatusChange };
export type { GenerationNotifyInput };

export function vapidConfigured(env: Pick<Env, "VAPID_PUBLIC_KEY" | "VAPID_PRIVATE_KEY">): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY?.trim() && env.VAPID_PRIVATE_KEY?.trim());
}

export function vapidSubject(env: Pick<Env, "VAPID_SUBJECT" | "PUBLIC_BASE_URL">): string {
  const subject = env.VAPID_SUBJECT?.trim();
  if (subject) return subject;
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/$/, "");
  return "https://studio.digisavvy.dev";
}

export function parsePushSubscription(body: unknown): PushSubscriptionInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid push subscription");
  }
  const record = body as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  const endpoint = typeof record.endpoint === "string" ? record.endpoint.trim() : "";
  const p256dh = typeof record.keys?.p256dh === "string" ? record.keys.p256dh.trim() : "";
  const auth = typeof record.keys?.auth === "string" ? record.keys.auth.trim() : "";
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    throw new Error("Invalid push subscription");
  }
  return { endpoint, keys: { p256dh, auth } };
}

export async function savePushSubscription(
  db: D1Database,
  userId: string,
  subscription: PushSubscriptionInput,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const existing = await db
    .prepare(`SELECT id FROM push_subscriptions WHERE endpoint = ?`)
    .bind(subscription.endpoint)
    .first<{ id: string }>();
  if (existing?.id) {
    await db
      .prepare(
        `UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(userId, subscription.keys.p256dh, subscription.keys.auth, now, existing.id)
      .run();
    return;
  }
  await db
    .prepare(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      userId,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      now,
      now,
    )
    .run();
}

export async function deletePushSubscription(
  db: D1Database,
  userId: string,
  endpoint: string,
): Promise<void> {
  await db
    .prepare(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`)
    .bind(userId, endpoint)
    .run();
}

export async function userHasPushSubscription(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare(`SELECT id FROM push_subscriptions WHERE user_id = ? LIMIT 1`)
    .bind(userId)
    .first<{ id: string }>();
  return Boolean(row?.id);
}

export async function listPushSubscriptions(
  db: D1Database,
  userId: string,
): Promise<PushSubscriptionRecord[]> {
  const { results } = await db
    .prepare(`SELECT * FROM push_subscriptions WHERE user_id = ?`)
    .bind(userId)
    .all<PushSubscriptionRecord>();
  return results ?? [];
}

async function dropSubscription(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).bind(id).run();
}

export async function notifyUser(
  env: Env,
  userId: string,
  generation: GenerationNotifyInput,
): Promise<{ sent: number; dropped: number }> {
  if (!vapidConfigured(env) || !isTerminalNotifyStatus(generation.status)) {
    return { sent: 0, dropped: 0 };
  }

  const subscriptions = await listPushSubscriptions(env.DB, userId);
  if (subscriptions.length === 0) return { sent: 0, dropped: 0 };

  const copy = generationNotifyCopy(generation);
  const vapid = {
    subject: vapidSubject(env),
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };

  let sent = 0;
  let dropped = 0;
  for (const row of subscriptions) {
    try {
      const payload = await buildPushPayload(
        {
          data: copy,
          options: {
            ttl: 60 * 60,
            urgency: generation.status === "failed" ? "high" : "normal",
            topic: row.id.replace(/-/g, "").slice(0, 32),
          },
        },
        {
          endpoint: row.endpoint,
          expirationTime: null,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        vapid,
      );
      const res = await fetch(row.endpoint, payload);
      if (res.status === 404 || res.status === 410) {
        await dropSubscription(env.DB, row.id);
        dropped += 1;
        continue;
      }
      if (!res.ok) {
        console.error("push send failed", res.status);
        continue;
      }
      sent += 1;
    } catch (err) {
      console.error("push send error", err);
    }
  }
  return { sent, dropped };
}

export async function notifyGenerationComplete(
  env: Env,
  userId: string,
  previousStatus: string,
  generation: GenerationNotifyInput,
): Promise<void> {
  if (!shouldNotifyStatusChange(previousStatus, generation.status)) return;
  try {
    await notifyUser(env, userId, generation);
  } catch (err) {
    console.error("generation notify error", err);
  }
}
