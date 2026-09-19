export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  IMAGES?: ImagesBinding;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_ORG: string;
  GITHUB_ADMINS: string;
  ENCRYPTION_KEY: string;
  SESSION_SECRET: string;
  SESSION_TTL_SECONDS: string;
  PUBLIC_BASE_URL?: string;
  /** Local-only: `gh auth token`. Used when no OAuth app is configured. */
  GH_TOKEN?: string;
};

export type GenerationMode =
  | "text-to-image"
  | "image-to-image"
  | "text-to-video"
  | "reference-to-video"
  | "video-to-video";

export type UserRow = {
  id: string;
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  oxen_key_ciphertext: string | null;
  oxen_key_iv: string | null;
  created_at: number;
  updated_at: number;
};

export type SessionUser = {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
  hasOxenKey: boolean;
};
