import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * The join flow (spec section 10 rule 1, section 13 M4): a valid code opens
 * the student site, an invalid one fails politely, and attempts are rate
 * limited to 5 per minute per IP.
 *
 * Runs on the mobile project only (configured in playwright.config.ts): the
 * desktop project would double every attempt against the same shared
 * per-IP window in CI and break the rate-limit math below.
 *
 * Serial mode keeps the attempt order predictable: the setup project used
 * one attempt, this spec adds a valid one, an invalid one, then drives the
 * limit with invalid attempts until the block message appears.
 */
test.describe.configure({ mode: "serial" });

const JOIN_URL = "/s/join";
const CODE_INPUT = (page: Page): Locator => page.getByLabel("Join code");
const SUBMIT = (page: Page): Locator =>
  page.getByRole("button", { name: "Open my courses" });

test("the join page renders for new students", async ({ page }) => {
  await page.goto(JOIN_URL);
  await expect(
    page.getByRole("heading", { name: "Welcome to Study Hub" }),
  ).toBeVisible();
  await expect(CODE_INPUT(page)).toBeVisible();
  await expect(SUBMIT(page)).toBeEnabled();
});

test("a valid code opens the student home", async ({ page }) => {
  await page.goto(JOIN_URL);
  await CODE_INPUT(page).fill("SEED-2026");
  await SUBMIT(page).click();

  await expect(page).toHaveURL(/\/s$/);
  await expect(page.getByRole("heading", { name: "My courses" })).toBeVisible();
  await expect(page.getByText("Course A (sample)")).toBeVisible();
});

test("an invalid code shows a friendly error", async ({ page }) => {
  await page.goto(JOIN_URL);
  await CODE_INPUT(page).fill("WRNG-WRNG");
  await SUBMIT(page).click();

  await expect(page.getByRole("alert")).toContainText(
    "That code is not valid, or it has expired",
  );
  await expect(page).toHaveURL(new RegExp(JOIN_URL));
});

test("too many attempts are rate limited", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto(JOIN_URL);

  // Submit invalid codes until the block appears. Tolerant of window
  // boundaries: the 5-per-minute counter may still have slots left from
  // earlier tests, or the fixed window may reset mid-loop, so we keep
  // trying (well past the limit) until "Too many tries" shows up.
  let blocked = false;
  for (let attempt = 0; attempt < 10 && !blocked; attempt++) {
    await CODE_INPUT(page).fill("WRNG-WRNG");
    await SUBMIT(page).click();
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 10_000 });
    if ((await alert.textContent())?.includes("Too many tries")) {
      blocked = true;
    }
  }

  expect(blocked).toBe(true);
  // The block must never open the student site.
  await expect(page).toHaveURL(new RegExp(JOIN_URL));
});
