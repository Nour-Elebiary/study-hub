import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { join } from "node:path";

/**
 * Canvas e2e (CANVAS-SPEC section 5.9, acceptance a–d; M9 scope).
 *
 * (a) The leader generates a map from the seeded course, adds a text card,
 *     moves it, adds two note cards (one draft), connects two cards, then
 *     reloads and sees the same map. (b) The leader publishes the private
 *     map; the joined student (SEED-2026 storage state) sees only the
 *     published cards and taps a note card, which lands on the note.
 *     (c) A draft map id shows the not-found screen to the student.
 *     (d) When a map is full, the message is in plain language.
 *
 * Shared database: mobile and desktop projects run this file in parallel
 * against the same seeded course, so the interactive parts run on a
 * uniquely titled per-project map ("… <project>"). The generate step is
 * validated by the status message plus the generated list row only — two
 * generated maps can coexist. There is no student redirect test for /s/map:
 * it would race on which default map wins.
 *
 * The card-cap test leaves `max_canvas_cards` at 20 on purpose: restoring
 * the default would race the other project's own cap test. Every CI run
 * resets the database, so settings fall back to the default 300.
 */

const COURSE_A = "cccccccc-0000-cccc-0000-000000000001";
const CANVAS_LIST = `/courses/${COURSE_A}/canvas`;
const PUBLISHED_NOTE_ID = "eeeeeeee-0000-eeee-0000-000000000003";
const STUDENT_STATE_PATH = join(
  process.cwd(),
  "playwright",
  ".auth",
  "student.json",
);
const LEADER_STATE_PATH = join(
  process.cwd(),
  "playwright",
  ".auth",
  "leader.json",
);
const LEADER_PASSWORD = "e2e-Leader-2026";
const CARD_LIMIT = 20;
const FULL_MESSAGE =
  `This map is full (limit ${CARD_LIMIT} cards). ` +
  "Remove cards or start a second map.";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoSeriousViolations(page: Page, path: string) {
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
const card = (page: Page, text: string): Locator =>
  page.locator(".react-flow__node", { hasText: text });

/** The card's map position, read from its React Flow translate transform. */
async function nodePosition(
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
async function connectCards(page: Page, fromText: string, toText: string) {
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
async function dragCard(page: Page, text: string, dx: number, dy: number) {
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

/** Waits out the 800 ms save debounce, then confirms the batch was saved. */
async function expectSaved(page: Page) {
  await page.waitForTimeout(900);
  await expect(page.getByText(/^Saved$/)).toBeVisible({ timeout: 16_000 });
}

/**
 * Runs one step with a fresh student context (the joined SEED-2026 student)
 * at the current project's viewport, without importing another spec file —
 * importing it would register its tests twice.
 */
async function withStudent(
  browser: Browser,
  testInfo: TestInfo,
  run: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({
    storageState: STUDENT_STATE_PATH,
    // The same viewport the tests themselves run at (360 × 800 on the
    // mobile project, the Desktop Chrome default on desktop) — typed by
    // Playwright's project options, no cast needed.
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
async function createMap(page: Page, title: string): Promise<string> {
  await page.goto(CANVAS_LIST);
  await expect(page.getByLabel("New map")).toBeVisible({ timeout: 16_000 });
  await page.getByLabel("New map").fill(title);
  await page.getByRole("button", { name: /^New map$/ }).click();
  await expect(page).toHaveURL(/\/canvas\/[0-9a-f-]+$/, {
    timeout: 16_000,
  });
  // The editor loads behind a dynamic client loader; wait for its toolbar.
  await expect(page.getByRole("button", { name: "Add text card" })).toBeVisible(
    { timeout: 16_000 },
  );
  return new URL(page.url()).pathname;
}

test.describe.serial("canvas (M9 acceptance a–d)", () => {
  test.use({ storageState: LEADER_STATE_PATH });

  // Shared across the serial tests of one worker (one per project).
  let harnessPath: string;

  test("(a) the leader generates a map and can edit one of their own", async ({
    page,
  }) => {
    const project = test.info().project.name;

    // Generate from the seeded course (plan: notes → one map, core card +
    // one group; the first canvas becomes the course default).
    await page.goto(CANVAS_LIST);
    await expect(page.getByLabel("New map")).toBeVisible({ timeout: 16_000 });
    await page.getByRole("button", { name: "Generate from course" }).click();
    await expect(page.getByText("Your course map is ready.")).toBeVisible({
      timeout: 32_000,
    });
    await expect(
      page.getByRole("link", { name: "Course A (sample)" }).first(),
    ).toBeVisible();

    // A private draft map for the interactive parts (unique per project so
    // the parallel desktop project cannot collide with this one).
    harnessPath = await createMap(page, `E2E map — ${project}`);

    // Add a text card, then move it with a mouse drag.
    await page.getByRole("button", { name: "Add text card" }).click();
    await expect(card(page, "Write here…")).toBeVisible({ timeout: 10_000 });
    await dragCard(page, "Write here…", 80, 40);

    // Add both seeded course notes through the picker: one published quiz
    // note, one draft lecture note (students must see only the first).
    // Cards spawn around the viewport centre, and at the 360 px width the
    // 320 px note cards overlap each other and the text card, which would
    // block the handle hover during the connect step. Pull each new note
    // into its own clear corner first: the quiz note drags down, the draft
    // note drags up.
    for (const noteTitle of ["Quiz 1 prep", "Lecture 1 (draft)"]) {
      await page.getByRole("button", { name: "Add note" }).click();
      await expect(
        page.getByRole("heading", { name: "Choose a note" }),
      ).toBeVisible();
      // The picker's button shows the title plus a Published/Draft tag, so
      // the plain title matches by substring (Playwright role names).
      await page.getByRole("button", { name: noteTitle }).click();
      await expect(card(page, noteTitle)).toBeVisible({ timeout: 10_000 });
      const quiz = noteTitle === "Quiz 1 prep";
      await dragCard(page, noteTitle, quiz ? -60 : -80, quiz ? 250 : -180);
    }

    // Connect the published note to the text card, and let the save settle.
    await connectCards(page, "Quiz 1 prep", "Write here…");
    await expectSaved(page);

    // The drag committed a snapped position; read it now that the batch
    // the drag belongs to has been confirmed saved.
    const moved = await nodePosition(page, "Write here…");

    // Reload: the same map comes back from the server, with the moved card
    // exactly where the drag left it (snapped to the 20 px grid).
    await page.reload();
    await expect(card(page, "Write here…")).toBeVisible({ timeout: 16_000 });
    await expect(card(page, "Quiz 1 prep")).toBeVisible();
    await expect(card(page, "Lecture 1 (draft)")).toBeVisible();
    await expect(page.locator(".react-flow__edge")).toHaveCount(1);
    const reloaded = await nodePosition(page, "Write here…");
    expect(reloaded).toEqual(moved);

    // axe on the editor page, at this project's width (360 or 1280).
    await expectNoSeriousViolations(page, harnessPath);
  });

  test("(b) the leader publishes the map", async ({ page }) => {
    await page.goto(harnessPath);
    await expect(
      page.getByRole("button", { name: "Add text card" }),
    ).toBeVisible({ timeout: 16_000 });
    // The checkbox's accessible name is its wrapping label, which flips
    // between the two plain-language states.
    const publish = page.getByRole("checkbox", {
      name: /Students can see|Hidden from students/,
    });
    // `check()` verifies the state immediately after its own click, but the
    // flip commits only once the publish server action's response lands
    // (~40 ms later; the checkbox is also briefly disabled while the action
    // runs), so click and then poll with a retrying assertion instead.
    await publish.click();
    await expect(publish).toBeChecked({ checked: true, timeout: 16_000 });
    // The wrapping label's accessible name flips to the "Students can see"
    // wording once the map is published — a second, independent sync signal.
    await expect(publish).toHaveAccessibleName(/Students can see/, {
      timeout: 16_000,
    });
  });

  test("(b) the student sees only published cards and opens a note", async ({
    browser,
  }, testInfo) => {
    const canvasId = harnessPath.split("/").pop()!;
    await withStudent(browser, testInfo, async (studentPage) => {
      await studentPage.goto(`/s/canvas/${canvasId}`);
      await expect(
        studentPage.getByRole("heading", {
          name: `E2E map — ${testInfo.project.name}`,
        }),
      ).toBeVisible({ timeout: 16_000 });

      // D9: at phone width the outline comes first and the map opens on
      // demand; at 1280 px the map is already visible.
      const openMap = studentPage.getByRole("button", { name: "Open map" });
      if (await openMap.isVisible()) await openMap.click();
      const fit = studentPage.getByRole("button", { name: "Fit" });
      if (await fit.isVisible()) {
        await fit.click();
      }
      await expect(card(studentPage, "Quiz 1 prep")).toBeVisible({
        timeout: 16_000,
      });

      // The draft lecture note's card is invisible to students (spec 5.2).
      await expect(card(studentPage, "Lecture 1 (draft)")).toHaveCount(0);

      // Tapping the published note card lands on the note itself.
      await card(studentPage, "Quiz 1 prep").click();
      await expect(studentPage).toHaveURL(
        new RegExp(`/s/notes/${PUBLISHED_NOTE_ID}$`),
        { timeout: 16_000 },
      );
      await expect(
        studentPage.getByRole("heading", { name: "Quiz 1 prep", exact: true }),
      ).toBeVisible();

      // axe on the student viewer page (continue from the map view).
      await studentPage.goBack();
      await expect(card(studentPage, "Quiz 1 prep")).toBeVisible({
        timeout: 16_000,
      });
      await expectNoSeriousViolations(studentPage, `/s/canvas/${canvasId}`);
    });
  });

  test("(c) the student cannot open a draft map", async ({
    page,
    browser,
  }, testInfo) => {
    // The leader makes a brand-new map and never publishes it.
    const draftPath = await createMap(
      page,
      `Draft map — ${testInfo.project.name}`,
    );

    await withStudent(browser, testInfo, async (studentPage) => {
      // draftPath is the *leader* editor route returned by createMap; a
      // student hitting it is redirected to sign-in. Students open maps,
      // including not-found ones, on their own /s/canvas route.
      const canvasId = draftPath.split("/").pop()!;
      await studentPage.goto(`/s/canvas/${canvasId}`);
      // Drafts stream a 200 but render the standard not-found screen
      // (QUESTIONS #27): its explanatory paragraph tells the student why,
      // and no editing or canvas content leaks into the document.
      await expect(
        studentPage.getByRole("heading", { name: "Page not found" }),
      ).toBeVisible({ timeout: 16_000 });
      await expect(
        studentPage.getByText("This page does not exist"),
      ).toBeVisible();
      await expect(
        studentPage.getByRole("button", { name: "Add text card" }),
      ).toHaveCount(0);
      await expect(studentPage.locator(".react-flow__node")).toHaveCount(0);
    });
  });

  test("(d) a full map explains itself in plain language", async ({
    page,
  }, testInfo) => {
    // Cap the cards on one map (persisted on purpose — the other project's
    // own copy of this test writes the same value; CI resets the database).
    await page.goto("/admin/settings");
    const cardsInput = page.getByLabel("Most cards on one map");
    await expect(cardsInput).toBeVisible({ timeout: 16_000 });
    await cardsInput.fill(String(CARD_LIMIT));
    await page.getByRole("button", { name: "Save settings" }).click();
    // Editing limits needs a login younger than 10 minutes. The setup
    // project usually signs the leader in moments before, so only fill the
    // confirmation if it was actually asked for (the save answer shows
    // either the success line or the password field).
    const saved = page.getByText("Settings saved.");
    const requested = page.getByLabel("Confirm your password to save");
    await expect(saved.or(requested).first()).toBeVisible({ timeout: 16_000 });
    if (await requested.isVisible()) {
      await requested.fill(LEADER_PASSWORD);
      await page.getByRole("button", { name: "Save settings" }).click();
    }
    await expect(saved).toBeVisible();

    // Fill a fresh map beyond the cap: 21 adds against 20.
    await createMap(page, `Card cap — ${testInfo.project.name}`);
    const add = page.getByRole("button", { name: "Add text card" });
    for (let i = 0; i < CARD_LIMIT + 1; i++) {
      await add.click();
    }
    // The RPC refuses the batch and the server action maps the error to
    // plain language; the editor shows it under the toolbar (role=alert).
    await expect(page.getByText(FULL_MESSAGE)).toBeVisible({
      timeout: 32_000,
    });
  });
});
