import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { join } from "node:path";

/**
 * Shared canvas e2e helpers, extracted from canvas.spec.ts (M9) so the M10
 * spec can reuse them without importing the M9 spec file — importing it
 * would register its tests twice.
 *
 * Shared database: the mobile and desktop projects run the canvas specs in
 * parallel against the same seeded course, so every map a test edits gets a
 * per-project title ("… — <project>"). Per-run screen questions: see
 * docs/QUESTIONS.md rows 46 and 54.
 */

export const COURSE_A = "cccccccc-0000-cccc-0000-000000000001";
export const CANVAS_LIST = `/courses/${COURSE_A}/canvas`;
export const PUBLISHED_NOTE_ID = "eeeeeeee-0000-eeee-0000-000000000003";
export const STUDENT_STATE_PATH = join(
  process.cwd(),
  "playwright",
  ".auth",
  "student.json",
);
export const LEADER_STATE_PATH = join(
  process.cwd(),
  "playwright",
  ".auth",
  "leader.json",
);
export const LEADER_PASSWORD = "e2e-Leader-2026";
export const CARD_LIMIT = 20;
export const FULL_MESSAGE =
  `This map is full (limit ${CARD_LIMIT} cards). ` +
  "Remove cards or start a second map.";

export const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
];

export async function expectNoSeriousViolations(page: Page, path: string) {
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

/** A card node on the map, matched by any text it shows. */
export const card = (page: Page, text: string): Locator =>
  page.locator(".react-flow__node", { hasText: text });

/** The card's map position, read from its React Flow translate transform. */
export async function nodePosition(
  page: Page,
  text: string,
): Promise<[number, number]> {
  const transform = await card(page, text).evaluate((el) => el.style.transform);
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform);
  expect(
    match,
    `card "${text}" should carry a translate transform`,
  ).toBeTruthy();
  return [Number(match![1]), Number(match![2])];
}

/**
 * Draws an edge: drag from the right-hand connection handle of the first
 * card and drop anywhere on the second (connection mode is loose). Waits
 * until React Flow shows one edge (the optimistic onConnect insert).
 */
export async function connectCards(
  page: Page,
  fromText: string,
  toText: string,
) {
  const from = card(page, fromText).locator(
    '.react-flow__handle[data-handleid="right"]',
  );
  // React Flow completes a connection only when the release lands on a
  // handle (loose mode lets the same handle serve as the endpoint), so the
  // drop goes to the target's left handle, not its body centre.
  const to = card(page, toText).locator(
    '.react-flow__handle[data-handleid="left"]',
  );
  const target = await to.boundingBox();
  expect(
    target,
    `left handle of "${toText}" should have a bounding box`,
  ).toBeTruthy();
  await from.hover();
  await page.mouse.down();
  await page.mouse.move(
    target!.x + target!.width / 2,
    target!.y + target!.height / 2,
    { steps: 8 },
  );
  await page.mouse.up();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1, {
    timeout: 16_000,
  });
}

/** Moves a card by (dx, dy): press its centre, drag, release. */
export async function dragCard(
  page: Page,
  text: string,
  dx: number,
  dy: number,
) {
  const box = await card(page, text).boundingBox();
  expect(box, `card "${text}" should have a bounding box`).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + dx,
    box!.y + box!.height / 2 + dy,
    { steps: 6 },
  );
  await page.mouse.up();
}

/**
 * Waits until the editor is mounted. The labelled "Map: <title>" region
 * (spec 6.9) renders as soon as the client editor mounts, at every width —
 * unlike the toolbar buttons, which are split by width (top toolbar on
 * desktop, the phone bar below 768 px).
 */
export async function mapReady(page: Page) {
  await expect(page.getByRole("region", { name: /^Map: / })).toBeVisible({
    timeout: 16_000,
  });
}

/**
 * Adds one text card. The top toolbar's "Add text card" exists only at
 * >= 768 px (Toolbar is max-md:hidden); the phone bar's Add sheet is the
 * same action below that.
 */
export async function addTextCard(page: Page) {
  const top = page.getByRole("button", { name: "Add text card" });
  if (await top.isVisible()) {
    await top.click();
    return;
  }
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Text", exact: true }).click();
}

/** Opens the note picker, the same way on both widths. */
export async function openNotePicker(page: Page) {
  const top = page.getByRole("button", { name: "Add note" });
  if (await top.isVisible()) {
    await top.click();
    return;
  }
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: "Note", exact: true }).click();
}

/**
 * Reveals the publish toggle: it lives in the top toolbar at >= 768 px and
 * in the phone bar's More sheet below; the caller then uses the same
 * checkbox locator on both widths.
 */
export async function openPublishToggle(page: Page) {
  const more = page.getByRole("button", { name: "More", exact: true });
  if (await more.isVisible()) await more.click();
}

/**
 * The save chip, resolved through the accessibility tree. Text locators
 * would match BOTH toolbars' chips (each width hides one with a Tailwind
 * breakpoint class, but hidden elements still hold text); role locators
 * only see the element the width does not hide.
 */
export const savedChip = (page: Page): Locator =>
  page.getByRole("status").filter({ hasText: /^Saved$/ });

/** Waits out the 800 ms save debounce, then confirms the batch was saved. */
export async function expectSaved(page: Page) {
  await page.waitForTimeout(900);
  await expect(savedChip(page)).toBeVisible({ timeout: 16_000 });
}

/**
 * Runs one step with a fresh student context (the joined SEED-2026 student)
 * at the current project's viewport.
 */
export async function withStudent(
  browser: Browser,
  testInfo: TestInfo,
  run: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({
    storageState: STUDENT_STATE_PATH,
    // The same viewport the tests themselves run at (360 × 800 on the
    // mobile project, the Desktop Chrome default on desktop).
    viewport: testInfo.project.use.viewport ?? undefined,
  });
  const page = await context.newPage();
  try {
    await run(page);
  } finally {
    await context.close();
  }
}

/** Creates a private map (leader side) and lands the editor on its URL. */
export async function createMap(
  page: Page,
  title: string,
  courseId: string = COURSE_A,
): Promise<string> {
  await page.goto(`/courses/${courseId}/canvas`);
  await expect(page.getByLabel("New map")).toBeVisible({ timeout: 16_000 });
  await page.getByLabel("New map").fill(title);
  await page.getByRole("button", { name: /^New map$/ }).click();
  await expect(page).toHaveURL(/\/canvas\/[0-9a-f-]+$/, {
    timeout: 16_000,
  });
  // The editor loads behind a dynamic client loader; the labelled map
  // region is its width-independent mount signal.
  await mapReady(page);
  return new URL(page.url()).pathname;
}
