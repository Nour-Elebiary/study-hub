import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * Setup project (runs before the mobile/desktop projects): joins as a
 * student through the real UI with the seeded join code and saves the
 * resulting cookie as a Playwright storage state. The read-only specs then
 * reuse it instead of joining again — which also keeps the join rate limit
 * (5 per minute per IP) free for student-join.spec.ts.
 */

export const STUDENT_STATE_PATH = join(
  process.cwd(),
  "playwright",
  ".auth",
  "student.json",
);

test("join with the seeded code and save the student session", async ({
  page,
}) => {
  mkdirSync(dirname(STUDENT_STATE_PATH), { recursive: true });

  await page.goto("/s/join");
  await expect(
    page.getByRole("heading", { name: "Welcome to Study Hub" }),
  ).toBeVisible();

  await page.getByLabel("Join code").fill("SEED-2026");
  await page.getByRole("button", { name: "Open my courses" }).click();

  await expect(page).toHaveURL(/\/s$/);
  await expect(page.getByRole("heading", { name: "My courses" })).toBeVisible();
  await expect(page.getByText("Course A (sample)")).toBeVisible();

  await page.context().storageState({ path: STUDENT_STATE_PATH });
});
