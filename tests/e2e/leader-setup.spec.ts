import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Leader setup project: signs in with the seeded local/CI admin account and
 * clears the forced first-sign-in password change, then saves the session as
 * a Playwright storage state for the canvas (and future leader) specs.
 *
 * Like the seed itself, this password belongs to a throwaway account that
 * only exists in local/CI databases (supabase/seed.sql reset on every run) —
 * it is never a production credential.
 */

const LEADER_EMAIL = "admin@studyhub.local";
const LEADER_FIRST_PASSWORD = "ChangeMe-Admin-01"; // seeded temporary password
const LEADER_PASSWORD = "e2e-Leader-2026";

export const LEADER_STATE_PATH = join(
  process.cwd(),
  "playwright",
  ".auth",
  "leader.json",
);

test("sign in as the seeded leader and save the leader session", async ({
  page,
}) => {
  mkdirSync(dirname(LEADER_STATE_PATH), { recursive: true });

  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(LEADER_EMAIL);
  await page.getByLabel("Password").fill(LEADER_FIRST_PASSWORD);
  await page.getByRole("button", { name: /^Sign in$/ }).click();

  // The seeded account must choose a password before it can do anything
  // (every leader page redirects to /reset-password while the flag is set).
  await expect(page).toHaveURL(/\/reset-password/);
  await page.getByLabel("New password", { exact: true }).fill(LEADER_PASSWORD);
  await page.getByLabel("Repeat the new password").fill(LEADER_PASSWORD);
  await page.getByRole("button", { name: "Save password" }).click();

  // Back in the app with a working session.
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("link", { name: "Courses" }).first(),
  ).toBeVisible();

  await page.context().storageState({ path: LEADER_STATE_PATH });
});
