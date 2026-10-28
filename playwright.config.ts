import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests. The mobile project is first-class because the app is designed
 * at 360 px width first (spec section 10).
 * Run locally only when the app + local Supabase (Docker) are set up: `npm run test:e2e`
 * CI runs the same suite against a seeded local Supabase (see .github/workflows/ci.yml).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
  },
  projects: [
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 360, height: 800 },
      },
    },
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --turbopack",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 2 * 60 * 1000,
  },
});
