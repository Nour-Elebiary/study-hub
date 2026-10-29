import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests. The mobile project is first-class because the app is designed
 * at 360 px width first (spec section 10).
 * Run locally only when the app + local Supabase (Docker) are set up: `npm run test:e2e`
 * CI runs the same suite against a seeded local Supabase (see .github/workflows/ci.yml).
 *
 * With E2E_PROD=1 the suite runs against a production build (`npm run
 * start`) instead of the dev server — required for the offline test,
 * because the service worker registers only in production.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    // Keep a trace for every failing test so CI artifacts show what the
    // page actually did (uploaded by the workflow on failure).
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /student-setup\.spec\.ts/,
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 360, height: 800 },
      },
      dependencies: ["setup"],
      // The setup file runs once in its own project; the join spec is
      // mobile-only because the join rate limit (5/min per IP) is shared
      // by every context in a run — desktop duplicates would break it.
      testIgnore: /student-setup\.spec\.ts/,
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /student-setup\.spec\.ts|student-join\.spec\.ts/,
    },
  ],
  webServer: {
    command: process.env.E2E_PROD
      ? "npm run start"
      : "npm run dev -- --turbopack",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 2 * 60 * 1000,
  },
});
