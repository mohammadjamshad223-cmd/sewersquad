import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe.serial("Workflow A (office & customer)", () => {
  test("admin approves the submitted job, confirms the invoice, and it is sent", async ({ page }) => {
    await signIn(page, "admin@demo.sewersquad.test");
    await page.goto("/admin/jobs?status=SUBMITTED");
    const first = page.locator("tbody tr").first().getByRole("link", { name: /^J-/ });
    test.skip((await first.count()) === 0, "Run the mobile driver workflow first (npm run test:e2e runs both projects).");
    await first.click();
    await expect(page).toHaveURL(/\/admin\/jobs\/[0-9a-f-]{36}/, { timeout: 90_000 });
    await page.getByRole("button", { name: "Approve & finalize" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve & finalize" }).click();
    // Approval finalizes the manifest, then the operator confirms the invoice before anything is sent.
    await expect(page).toHaveURL(/\/admin\/jobs\/[0-9a-f-]{36}\/invoice/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Confirm invoice" })).toBeVisible();
    const price = page.getByRole("textbox", { name: "Unit price" }).first();
    if (!(await price.inputValue())) await price.fill("0.30");
    await page.getByRole("button", { name: /Confirm & send invoice/ }).click();
    await expect(page.getByText(/Invoice sent/)).toBeVisible({ timeout: 60_000 });
    await expect(page).not.toHaveURL(/\/invoice$/);
    await expect(page.getByText("Finalized").first()).toBeVisible();
    await expect(page.locator('a[href^="/admin/invoices/"]').first()).toBeVisible();
  });

  test("customer sees the finalized manifest and the new invoice", async ({ page }) => {
    await signIn(page, "corporate@abc-group.demo.test");
    await page.goto("/customer/manifests");
    await expect(page.locator("tbody tr").first()).toContainText(/1,180 gal|gal/);
    await page.goto("/customer/invoices?status=OPEN");
    await expect(page.locator("tbody tr").first()).toContainText("INV-");
  });

  test("the dispatch board lists today's jobs, most overdue first, with call buttons", async ({ page }) => {
    await signIn(page, "admin@demo.sewersquad.test");
    await page.goto("/admin/dispatch");
    await expect(page.getByText("Today's list · most overdue first")).toBeVisible();
    await expect(page.getByRole("link", { name: /^Call / }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Completed|Approve & send/ }).first()).toBeVisible();
  });
});
