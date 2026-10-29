import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Accessibility audit (spec section 13, M8: "No serious accessibility
 * violations (axe)"). Runs axe-core with the WCAG 2.2 A/AA rules on the
 * pages every visitor and student touches. The acceptance bar is the
 * spec's own: no serious or critical violations.
 *
 * The student pages reuse the storage state saved by student-setup.spec.ts.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoSeriousViolations(page: Page, path: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} nodes`),
    `serious accessibility violations on ${path}`,
  ).toEqual([]);
}

test.use({ storageState: "playwright/.auth/student.json" });

test("public pages pass the axe audit", async ({ page }) => {
  for (const path of ["/", "/login", "/s/join"]) {
    await page.goto(path);
    await expectNoSeriousViolations(page, path);
  }
});

test("student pages pass the axe audit", async ({ page }) => {
  for (const path of ["/s", "/s/notes/eeeeeeee-0000-eeee-0000-000000000003"]) {
    await page.goto(path);
    await expectNoSeriousViolations(page, path);
  }
});
