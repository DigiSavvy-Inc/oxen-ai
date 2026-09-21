import type { Env, UserRow } from "../worker/types";

export const TEST_USER: UserRow = {
  id: "user-1",
  github_id: 1,
  login: "tester",
  name: "Tester",
  avatar_url: null,
  oxen_key_ciphertext: null,
  oxen_key_iv: null,
  created_at: 1_700_000_000,
  updated_at: 1_700_000_000,
};

export const TEST_SESSION_ID = "session-1";
export const TEST_SECRET = "test-encryption-key";

type StoredObject = {
  body: ArrayBuffer;
  contentType: string;
};

export function createMockR2(): {
  store: Map<string, StoredObject>;
  bucket: R2Bucket;
} {
  const store = new Map<string, StoredObject>();
  const bucket = {
    async put(
      key: string,
      value: ArrayBuffer | ArrayBufferView | string | Blob,
      options?: { httpMetadata?: { contentType?: string } },
    ) {
      let body: ArrayBuffer;
      if (value instanceof ArrayBuffer) {
        body = value;
      } else if (ArrayBuffer.isView(value)) {
        body = value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength,
        ) as ArrayBuffer;
      } else if (typeof value === "string") {
        body = new TextEncoder().encode(value).buffer as ArrayBuffer;
      } else {
        body = await value.arrayBuffer();
      }
      store.set(key, {
        body,
        contentType: options?.httpMetadata?.contentType || "application/octet-stream",
      });
      return {};
    },
    async get(key: string) {
      const obj = store.get(key);
      if (!obj) return null;
      return {
        body: obj.body,
        size: obj.body.byteLength,
        httpMetadata: { contentType: obj.contentType },
        arrayBuffer: async () => obj.body,
        writeHttpMetadata(headers: Headers) {
          headers.set("Content-Type", obj.contentType);
        },
      };
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
  return { store, bucket: bucket as unknown as R2Bucket };
}

export function createMockDb(user: UserRow, sessionId: string): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (sql.includes("FROM sessions") && args[0] === sessionId) {
                return user;
              }
              return null;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              return { success: true };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

export function createEnv(overrides: Partial<Env> = {}): Env {
  const { bucket } = createMockR2();
  return {
    DB: createMockDb(TEST_USER, TEST_SESSION_ID),
    MEDIA: bucket,
    GITHUB_CLIENT_ID: "",
    GITHUB_CLIENT_SECRET: "",
    GITHUB_ORG: "DigiSavvy-Inc",
    GITHUB_ADMINS: "tester",
    ENCRYPTION_KEY: TEST_SECRET,
    SESSION_SECRET: "session-secret",
    SESSION_TTL_SECONDS: "604800",
    ...overrides,
  };
}
