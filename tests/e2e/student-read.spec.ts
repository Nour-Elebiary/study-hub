import { expect, test } from "@playwright/test";

/**
 * The read-only student site (spec section 10 rule 2, section 13 M4):
 * published content only, own course only, suggest-a-correction, and
 * offline reading of the last opened note.
 *
 * Uses the storage state saved by the setup project — no join attempts
 * here, so the join rate limit stays untouched.
 */
test.use({ storageState: "playwright/.auth/student.json" });

const PUBLISHED_NOTE = "/s/notes/eeeeeeee-0000-eeee-0000-000000000003";
const DRAFT_NOTE = "/s/notes/eeeeeeee-0000-eeee-0000-000000000002";
const OTHER_COURSE = "/s/courses/cccccccc-0000-cccc-0000-000000000002";

test("student home lists only the joined course", async ({ page }) => {
  await page.goto("/s");
  await expect(page.getByRole("heading", { name: "My courses" })).toBeVisible();
  await expect(page.getByText("Course A (sample)")).toBeVisible();
  await expect(page.getByText("Course B (sample)")).toHaveCount(0);
});

test("a published note renders with its body, tag, and assets", async ({
  page,
}) => {
  await page.goto(PUBLISHED_NOTE);
  await expect(
    page.getByRole("heading", { level: 1, name: "Quiz 1 prep" }),
  ).toBeVisible();
  // The body is Markdown-rendered, including Arabic text (comfort rule 6).
  await expect(
    page.getByText("Questions and answers for quiz 1."),
  ).toBeVisible();
  await expect(page.getByText("اختبار أول")).toBeVisible();
  // The seeded tag links to the tag filter page.
  await expect(page.getByRole("link", { name: "#quiz1" })).toBeVisible();
  // The seeded Drive asset opens in a new tab (spec section 10 rule 3).
  const driveLink = page.getByRole("link", {
    name: /Quiz 1 answer sheet/,
  });
  await expect(driveLink).toBeVisible();
  await expect(driveLink).toHaveAttribute("target", "_blank");
});

test("a draft note is not readable by students", async ({ page }) => {
  const response = await page.goto(DRAFT_NOTE);
  expect(response?.status()).toBe(404);
});

test("another course's page is not readable", async ({ page }) => {
  const response = await page.goto(OTHER_COURSE);
  expect(response?.status()).toBe(404);
});

test("a student can suggest a correction", async ({ page }) => {
  await page.goto(PUBLISHED_NOTE);
  await page.getByRole("button", { name: "Suggest a correction" }).click();
  await page
    .getByLabel("What should be corrected?")
    .fill("The quiz date on page 2 is wrong.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("status")).toContainText(
    "Thank you! Your teacher will see your correction.",
  );
});

test("the last opened note opens offline", async ({ page, context }) => {
  test.skip(
    !process.env.E2E_PROD,
    "the service worker registers only in production builds (E2E_PROD=1)",
  );

  // Open the note once, online.
  await page.goto(PUBLISHED_NOTE);
  await expect(
    page.getByRole("heading", { level: 1, name: "Quiz 1 prep" }),
  ).toBeVisible();

  // Wait for the service worker to take control, then reload so this
  // navigation is cached by the worker.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Quiz 1 prep" }),
  ).toBeVisible();

  // The worker stores visited notes in one of its caches; wait until the
  // page is actually in one before going offline.
  await expect
    .poll(() =>
      page.evaluate((url) => {
        const check = async (): Promise<boolean> => {
          for (const name of await caches.keys()) {
            const cache = await caches.open(name);
            if ((await cache.keys()).some((r) => r.url === url)) return true;
          }
          return false;
        };
        return check();
      }, page.url()),
    )
    .toBe(true);

  // Now cut the network and reload: the note must still render.
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Quiz 1 prep" }),
  ).toBeVisible();
});
