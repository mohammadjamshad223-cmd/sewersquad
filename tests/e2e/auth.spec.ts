import { expect, test } from "@playwright/test";
import { PASSWORD, signIn } from "./helpers";

test.describe("authentication & routing", () => {
  test("unauthenticated users are sent to login with a return path", async ({ page }) => {
    await page.goto("/admin/invoices");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Finvoices/);
  });

  test("wrong password shows one generic error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("corporate@abc-group.demo.test");
    await page.getByLabel("Password").fill("not-the-password-1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").first()).toContainText("Incorrect email or password.");
  });

  test("each role lands on its own portal and cannot open other portals", async ({ page }) => {
    await signIn(page, "corporate@abc-group.demo.test");
    await expect(page).toHaveURL(/\/customer\/dashboard/);
    await page.goto("/admin/dashboard");
    await expect(page).not.toHaveURL(/\/admin/);
    await page.goto("/driver/dashboard");
    await expect(page).not.toHaveURL(/\/driver/);
  });

  test("login form is keyboard operable and labelled", async ({ page }) => {
    await page.goto("/login");
    await page.keyboard.press("Tab"); // skip link
    await page.getByLabel("Email").focus();
    await page.keyboard.type("dispatch@demo.sewersquad.test");
    await page.keyboard.press("Tab");
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/admin\/dashboard/);
  });

  test("a dispatcher cannot open billing pages (server-side 403)", async ({ page }) => {
    await signIn(page, "dispatch@demo.sewersquad.test");
    await page.goto("/admin/invoices");
    await expect(page).toHaveURL(/\/403/);
  });
});
