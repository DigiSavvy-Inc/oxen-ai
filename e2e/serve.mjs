// Starts a throwaway Studio for the browser tests: its own database, bucket, config and
// secrets under e2e/.state, so a run never reads or changes a developer's local data.
// Nothing here talks to GitHub or Oxen.
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { experimental_readRawConfig } from "wrangler";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const state = join(here, ".state");
const persist = join(state, "persist");
const configPath = join(state, "wrangler.json");
const seed = JSON.parse(readFileSync(join(here, "seed.json"), "utf8"));

rmSync(state, { recursive: true, force: true });
mkdirSync(state, { recursive: true });

// The real config with paths made absolute, sign-in limited to the seeded admin, and no cron.
const { rawConfig } = experimental_readRawConfig({ config: join(root, "wrangler.jsonc") });
const config = {
  ...rawConfig,
  main: join(root, rawConfig.main),
  d1_databases: rawConfig.d1_databases.map((db) => ({ ...db, migrations_dir: join(root, db.migrations_dir) })),
  vars: { ...rawConfig.vars, GITHUB_ORG: "", GITHUB_ADMINS: String(seed.githubId) },
};
delete config.$schema;
delete config.triggers;
writeFileSync(configPath, JSON.stringify(config, null, 2));

// Wrangler reads .dev.vars from beside the config, so the developer's own file is never used.
const secret = () => randomBytes(32).toString("hex");
writeFileSync(
  join(state, ".dev.vars"),
  [
    `ENCRYPTION_KEY=${secret()}`,
    `SESSION_SECRET=${secret()}`,
    `MEDIA_SIGNING_KEY=${secret()}`,
    "GITHUB_CLIENT_ID=",
    "GITHUB_CLIENT_SECRET=",
    "",
  ].join("\n"),
);

const wrangler = join(root, "node_modules", ".bin", "wrangler");
const local = ["--local", "--config", configPath, "--persist-to", persist];
function run(args) {
  execFileSync(wrangler, args, { cwd: root, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, CI: "1" } });
}

const db = config.d1_databases[0].database_name;
const bucket = config.r2_buckets[0].bucket_name;
run(["d1", "migrations", "apply", db, ...local]);

// A signed-in admin and a few finished images in the library. The session is a plain row,
// the same one a real sign-in writes; the Worker has no test-only way in.
const now = Math.floor(Date.now() / 1000);
const sql = [
  `INSERT INTO users (id, github_id, login, name, avatar_url, created_at, updated_at)
   VALUES ('${seed.userId}', ${seed.githubId}, '${seed.login}', 'E2E Tester', '', ${now}, ${now});`,
  `INSERT INTO sessions (id, user_id, expires_at, created_at)
   VALUES ('${seed.sessionId}', '${seed.userId}', ${now + 86400}, ${now});`,
  ...seed.library.map(
    (item, index) =>
      `INSERT INTO generations
         (id, user_id, oxen_generation_id, mode, model, prompt, status, media_type, result_key, batch_id, created_at, updated_at)
       VALUES ('${item.id}', '${seed.userId}', 'oxen-${item.id}', 'text-to-image', 'e2e-model', '${item.prompt}',
         'succeeded', 'image', 'u/${seed.userId}/results/${item.id}.png', 'batch-${item.id}', ${now - index}, ${now - index});`,
  ),
];
const seedFile = join(state, "seed.sql");
writeFileSync(seedFile, sql.join("\n"));
run(["d1", "execute", db, ...local, "--file", seedFile]);
for (const item of seed.library) {
  run([
    "r2",
    "object",
    "put",
    `${bucket}/u/${seed.userId}/results/${item.id}.png`,
    "--file",
    join(here, "fixtures", item.fixture),
    "--content-type",
    "image/png",
    ...local,
  ]);
}

const vite = spawn(
  join(root, "node_modules", ".bin", "vite"),
  ["--config", join(here, "vite.config.ts"), "--port", String(seed.port), "--strictPort"],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, STUDIO_E2E_CONFIG: configPath, STUDIO_E2E_PERSIST: persist },
  },
);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => vite.kill(signal));
vite.on("exit", (code) => process.exit(code ?? 0));
