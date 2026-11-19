import { expect, test } from "@playwright/test";

// A token is shown once, works as a bearer, and stops working the moment it is revoked.
test("create an API token, see it once, revoke it", async ({ page, playwright }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Studio" }).getByRole("button", { name: "Settings" }).click();
  await page.getByRole("navigation", { name: "Settings" }).getByRole("button", { name: "API tokens", exact: true }).click();
  await expect(page.getByRole("heading", { name: "API tokens" })).toBeVisible();

  const name = `E2E agent ${Date.now()}`;
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel(/Daily cap/).fill("2.5");
  await page.getByRole("button", { name: "Create", exact: true }).click();

  const reveal = page.getByLabel(`New token: ${name}`);
  await expect(reveal).toHaveValue(/^dss_[A-Za-z0-9_-]{43}$/);
  const token = await reveal.inputValue();
  await expect(page.getByText("This is the only time it is shown.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeVisible();

  const row = page.locator(".token-row").filter({ hasText: name });
  await expect(row).toContainText(token.slice(0, 8));
  await expect(row).toContainText("$2.50 a day");

  // Without a cookie, the token signs in on its own.
  const bare = await playwright.request.newContext({ baseURL: new URL(page.url()).origin, storageState: { cookies: [], origins: [] } });
  const me = await bare.get("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
  expect(me.status()).toBe(200);
  expect((await me.json()).token).toEqual({ name, dailyCapUsd: 2.5, spentTodayUsd: 0 });

  // Done hides the token, and nothing shows it again.
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByLabel(`New token: ${name}`)).toHaveCount(0);
  await expect(page.getByText(token)).toHaveCount(0);

  // Revoke takes two clicks.
  await row.getByRole("button", { name: "Revoke", exact: true }).click();
  await expect(row.getByRole("button", { name: "Yes, revoke" })).toBeVisible();
  await row.getByRole("button", { name: "Yes, revoke" }).click();
  await expect(page.locator(".token-row").filter({ hasText: name })).toHaveCount(0);

  const after = await bare.get("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
  expect(after.status()).toBe(401);
  await bare.dispose();
});
