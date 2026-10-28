import { expect, test } from "@playwright/test";

test("the sign-in page renders the login form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sign in$/ })).toBeEnabled();
});

test("unauthenticated visitors are redirected to sign-in", async ({ page }) => {
  await page.goto("/courses");
  await expect(page).toHaveURL(/\/login/);
});
