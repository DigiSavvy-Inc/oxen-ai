import { defineConfig, devices } from "@playwright/test";
import seed from "./e2e/seed.json" with { type: "json" };

const baseURL = `http://localhost:${seed.port}`;

export default defineConfig({
  testDir: "e2e",
  // One Studio and one database for the whole run, so tests go one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // The seeded session row, as the cookie a real sign-in would have set.
    storageState: {
      cookies: [
        {
          name: "oxen_session",
          value: seed.sessionId,
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  },
  webServer: {
    command: "node e2e/serve.mjs",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    { name: "desktop", testIgnore: /phone\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } },
    { name: "phone", testMatch: /phone\.spec\.ts/, use: { ...devices["Pixel 7"] } },
  ],
});
