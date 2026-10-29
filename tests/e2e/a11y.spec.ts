import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Accessibility audit (spec section 13, M8: "No serious accessibility
 * violations (axe)"). Runs axe-core with the WCAG 2.2 A/AA rules on the
 * pages every visitor and student touches. The acceptance bar is the
 * spec's own: no serious or critical violations.
 *
 * The student audit reuses the storage state saved by student-setup.spec.ts;
 * it is scoped to that test only, so the public audit still visits /s/join
 * as an anonymous visitor (a joined student is redirected to /s, which made
 * the audit race the redirect and flake on the document title).
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoSeriousViolations(page: Page, path: string) {
  // Let the document title settle before auditing: a redirect right after
  // goto can otherwise leave the audit running against transient state.
  await expect(page).toHaveTitle(/.+/);
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} nodes`),
    `serious accessibility violations on ${path}`,
  ).toEqual([]);
}

test("public pages pass the axe audit", async ({ page }) => {
  for (const path of ["/", "/login", "/s/join"]) {
    await page.goto(path);
    await expectNoSeriousViolations(page, path);
  }
});

test.describe("student pages", () => {
  test.use({ storageState: "playwright/.auth/student.json" });

  test("student pages pass the axe audit", async ({ page }) => {
    for (const path of [
      "/s",
      "/s/notes/eeeeeeee-0000-eeee-0000-000000000003",
    ]) {
      await page.goto(path);
      await expectNoSeriousViolations(page, path);
    }
  });
});
