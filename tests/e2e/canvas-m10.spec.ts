import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  COURSE_A,
  LEADER_STATE_PATH,
  PUBLISHED_NOTE_ID,
  WCAG_TAGS,
  addTextCard,
  card,
  createMap,
  expectNoSeriousViolations,
  expectSaved,
  openNotePicker,
  savedChip,
} from "./canvas-helpers";

/**
 * Canvas e2e (CANVAS-SPEC section 6.11, M10 acceptance flows).
 *
 * Keyboard-only flow (create, connect, move, delete, undo); drop a file
 * from the computer; edit a note in the side pane while a second browser
 * context sees the lock; palette search and action; touch viewport:
 * Connect mode between two cards (mobile project only); offline banner and
 * recovery. axe runs on every flow at this project's width (360 or 1280).
 *
 * Spec gap (QUESTIONS 54): "drag a file from the drawer" has no drawer —
 * the picker covers the outcome, so the test drops a real file instead.
 * Spec gap (QUESTIONS 53): no connect key existed in the 6.3 table, so
 * `L` starts a link and Enter completes it.
 *
 * Shared database: the mobile and desktop projects run this file in
 * parallel against the same seeded course, so every map gets a
 * per-project title ("… -- <project>"); see docs/QUESTIONS.md 46.
 */

const LEADER2_EMAIL = "admin2@studyhub.local";
const LEADER2_FIRST_PASSWORD = "ChangeMe-Admin-02"; // seeded temporary password
const LEADER2_PASSWORD = "e2e-Leader2-2026";

test.describe.serial("canvas (M10 acceptance flows)", () => {
  test.use({ storageState: LEADER_STATE_PATH });

  test("keyboard-only flow: create, move, connect, delete, undo", async ({
    page,
  }, testInfo) => {
    const mapPath = await createMap(
      page,
      `M10 keys -- ${testInfo.project.name}`,
    );
    const node = page.locator(".react-flow__node");

    // Create two text cards with N (spec 6.2: N adds a card at the view
    // centre; each new card becomes the selection).
    await page.keyboard.press("n");
    await expect(node).toHaveCount(1, { timeout: 10_000 });
    await page.keyboard.press("n");
    await expect(node).toHaveCount(2, { timeout: 10_000 });

    // Move (spec: moves without touching the mouse): plain arrows nudge
    // the selected card one 20 px grid step per press.
    const secondBefore = await node.nth(1).evaluate((el) => el.style.transform);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => node.nth(1).evaluate((el) => el.style.transform), {
        timeout: 10_000,
      })
      .not.toBe(secondBefore);

    // Connect (QUESTIONS 53): L starts linking from the selected card.
    // exact: true — the same message also shows in the visible bottom
    // toast next to Undo; the sr-only live region announces it verbatim.
    await page.keyboard.press("l");
    await expect(
      page.getByText("Linking: Tab to the second card and press Enter", {
        exact: true,
      }),
    ).toBeVisible();
    // Tab roves focus to the other card; Enter links the two cards.
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator(".react-flow__edge")).toHaveCount(1, {
      timeout: 16_000,
    });

    // Delete (spec: Backspace removes the selected card from the map; the
    // reducer also drops edges that touched it).
    await page.keyboard.press("Backspace");
    await expect(node).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator(".react-flow__edge")).toHaveCount(0, {
      timeout: 10_000,
    });

    // Undo (Ctrl+Z) restores the card AND the edge with it.
    await page.keyboard.press("Control+z");
    await expect(node).toHaveCount(2, { timeout: 10_000 });
    await expect(page.locator(".react-flow__edge")).toHaveCount(1, {
      timeout: 10_000,
    });
    await expectSaved(page);

    await expectNoSeriousViolations(page, mapPath);
  });

  test("drop a file from the computer", async ({ page }, testInfo) => {
    const mapPath = await createMap(
      page,
      `M10 file -- ${testInfo.project.name}`,
    );

    // A tiny valid one-pixel PNG; the upload pipeline magic-byte-checks it.
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.setInputFiles('input[type="file"]', {
      name: "m10-drop.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });

    // The file card lands on the map with the uploaded file's name.
    await expect(card(page, "m10-drop.png")).toBeVisible({ timeout: 16_000 });
    await expectSaved(page);

    await expectNoSeriousViolations(page, mapPath);
  });

  test("palette search finds a card and runs the action", async ({
    page,
  }, testInfo) => {
    const mapPath = await createMap(
      page,
      `M10 palette -- ${testInfo.project.name}`,
    );
    await addTextCard(page);
    await expect(card(page, "Write here…")).toBeVisible({ timeout: 10_000 });

    // Ctrl/Cmd+K opens the palette (spec 6.7); the toolbar Search button
    // opens it for touch.
    await page.keyboard.press("Control+k");
    // cmdk's Dialog names the whole palette; its input is a combobox, not a
    // textbox (the accessibility tree shows `combobox "Command palette"`).
    const search = page
      .getByRole("dialog", { name: "Command palette" })
      .getByRole("combobox");
    await expect(search).toBeVisible({ timeout: 10_000 });

    // A nonsense query explains itself, then a real search filters to the
    // card on the map.
    await search.fill("zz9x-nothing-matches");
    await expect(page.getByText("No matches.")).toBeVisible();
    await search.fill("write");
    await expect(
      page.getByRole("option", { name: /Write here…/ }),
    ).toBeVisible();

    // Enter runs the highlighted action: pick the card — the palette
    // closes and the card becomes the selection (the plain-language
    // selected-card controls appear on the card itself; the toolbar shows
    // a second "Remove from map", so this pins the on-card chip).
    await page.keyboard.press("Enter");
    await expect(
      card(page, "Write here…").getByRole("button", {
        name: "Remove from map",
      }),
    ).toBeVisible({ timeout: 10_000 });

    await expectNoSeriousViolations(page, mapPath);
  });

  test("the side pane holds a lock a second context can see", async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(120_000); // password-change flow adds real time
    // The side-pane lock test only needs the editor open with the note's
    // card; the map itself is not asserted (context B visits the note's
    // own edit page directly).
    await createMap(page, `M10 lock -- ${testInfo.project.name}`);

    // Context A holds the lock: add the seeded published note card and
    // open it in the side pane.
    await openNotePicker(page);
    await expect(
      page.getByRole("heading", { name: "Choose a note" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Quiz 1 prep" }).click();
    await expect(card(page, "Quiz 1 prep")).toBeVisible({ timeout: 10_000 });
    await card(page, "Quiz 1 prep").click();
    // The editor textarea appears once the body loads; the lock acquires
    // right after mount. Give both a beat.
    await expect(page.getByText("Quiz 1 prep").first()).toBeVisible();
    await page.waitForTimeout(1_500);

    // Context B: the second seeded leader signs in (clearing its forced
    // first-sign-in password change on a fresh database; on a warmed local
    // database the already-changed password signs straight in).
    // Context B must be truly signed out: a bare newContext() inherits the
    // file-level test.use storage state (Nour's session), so /login would
    // just redirect to the home page. An explicit empty storage state
    // prevents that (Playwright's documented way to opt out).
    const contextB = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const pageB = await contextB.newPage();
    try {
      await pageB.goto("/login");
      await expect(
        pageB.getByRole("heading", { name: "Sign in" }),
      ).toBeVisible();
      await pageB.getByLabel("Email").fill(LEADER2_EMAIL);
      await pageB.getByLabel("Password").fill(LEADER2_FIRST_PASSWORD);
      await pageB.getByRole("button", { name: /^Sign in$/ }).click();
      await pageB
        .waitForURL(
          (url) => url.pathname === "/" || url.pathname === "/reset-password",
          { timeout: 16_000 },
        )
        .catch(() => undefined);
      if (!pageB.url().endsWith("/login")) {
        // Old password (still) valid — clear the forced change if asked.
        if (new URL(pageB.url()).pathname === "/reset-password") {
          await pageB
            .getByLabel("New password", { exact: true })
            .fill(LEADER2_PASSWORD);
          await pageB
            .getByLabel("Repeat the new password")
            .fill(LEADER2_PASSWORD);
          await pageB.getByRole("button", { name: "Save password" }).click();
          await expect(pageB).toHaveURL(/\/$/, { timeout: 16_000 });
        }
      } else {
        // The seeded temporary password was already changed on a previous
        // local run — sign in with the stored one.
        await pageB.getByLabel("Password").fill(LEADER2_PASSWORD);
        await pageB.getByRole("button", { name: /^Sign in$/ }).click();
        await expect(pageB).toHaveURL(/\/(reset-password)?$/, {
          timeout: 16_000,
        });
        if (new URL(pageB.url()).pathname === "/reset-password") {
          await pageB
            .getByLabel("New password", { exact: true })
            .fill(LEADER2_PASSWORD);
          await pageB
            .getByLabel("Repeat the new password")
            .fill(LEADER2_PASSWORD);
          await pageB.getByRole("button", { name: "Save password" }).click();
          await expect(pageB).toHaveURL(/\/$/, { timeout: 16_000 });
        }
      }

      await pageB.goto(`/courses/${COURSE_A}/nodes/${PUBLISHED_NOTE_ID}/edit`);
      // The lock banner names the holder, in plain language (spec 6.6):
      // "Nour (admin) is editing this note right now."
      await expect(
        pageB.getByText(/is editing this note right now/),
      ).toBeVisible({ timeout: 16_000 });
      await expect(pageB.getByText("Nour (admin)")).toBeVisible();
      await expectNoSeriousViolations(
        pageB,
        `/courses/${COURSE_A}/nodes/${PUBLISHED_NOTE_ID}/edit`,
      );
    } finally {
      await contextB.close();
    }
  });

  test("touch: Connect mode links two cards by tapping", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile",
      "touch Connect lives on the phone toolbar (spec 6.11 touch viewport)",
    );
    test.setTimeout(90_000);
    const mapPath = await createMap(
      page,
      `M10 connect -- ${testInfo.project.name}`,
    );
    const node = page.locator(".react-flow__node");

    await addTextCard(page);
    await expect(node).toHaveCount(1, { timeout: 10_000 });
    await addTextCard(page);
    await expect(node).toHaveCount(2, { timeout: 10_000 });

    // Toggle link mode from the phone bar, then tap tap. The announce
    // text also renders in the bottom toast (with Undo), so the live
    // region is matched with exact: true.
    await page.getByRole("button", { name: "Connect" }).tap();
    await expect(
      page.getByText(
        "Link mode: tap the first card, then the card it links to",
        { exact: true },
      ),
    ).toBeVisible();
    await node.first().tap();
    await expect(
      page.getByText("Linking: now tap the card it links to", { exact: true }),
    ).toBeVisible();
    await node.nth(1).tap();
    await expect(page.locator(".react-flow__edge")).toHaveCount(1, {
      timeout: 16_000,
    });

    await expect(
      page.getByRole("button", { name: "Stop linking" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Stop linking" }).tap();
    await expectNoSeriousViolations(page, mapPath);
  });

  test("offline banner pausing, recovery saving", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const mapPath = await createMap(
      page,
      `M10 offline -- ${testInfo.project.name}`,
    );

    // A clean state first: the chip says Saved.
    await expect(savedChip(page)).toBeVisible({ timeout: 16_000 });

    // Go offline; the queue pauses and explains in plain language
    // (spec 6.4: "You are offline. Your changes are kept …").
    await page.context().setOffline(true);
    await expect(
      page.getByText(
        "You are offline. Your changes are kept on this page until you are back.",
      ),
    ).toBeVisible({ timeout: 16_000 });

    // While offline, a change is kept on the page (the card still appears
    // — the op sits in the queue).
    await page.keyboard.press("n");
    await expect(card(page, "Write here…")).toBeVisible({ timeout: 10_000 });

    // axe sees the offline banner state too.
    const results = await new AxeBuilder({ page })
      .withTags(WCAG_TAGS)
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      serious.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} nodes`),
      `serious accessibility violations on ${mapPath} (offline)`,
    ).toEqual([]);

    // Recovery: back online the queue flushes and the chip returns to
    // Saved; the banner disappears.
    await page.context().setOffline(false);
    await expect(savedChip(page)).toBeVisible({ timeout: 16_000 });
    await expect(
      page.getByText(
        "You are offline. Your changes are kept on this page until you are back.",
      ),
    ).toHaveCount(0);
  });
});
