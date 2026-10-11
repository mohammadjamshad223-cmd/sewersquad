import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.describe.serial("Workflow A (office & customer)", () => {
  test("admin approves the submitted job: manifest finalized and invoice sent", async ({ page }) => {
    await signIn(page, "admin@demo.sewersquad.test");
    await page.goto("/admin/jobs?status=SUBMITTED");
    const first = page.locator("tbody tr").first().getByRole("link", { name: /^J-/ });
    test.skip((await first.count()) === 0, "Run the mobile driver workflow first (npm run test:e2e runs both projects).");
    await first.click();
    await expect(page).toHaveURL(/\/admin\/jobs\/[0-9a-f-]{36}/, { timeout: 90_000 });
    await page.getByRole("button", { name: "Approve & finalize" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Approve & finalize" }).click();
    await expect(page.getByText(/Approved\. Manifest finalized/)).toBeVisible();
    await page.reload();
    await expect(page.getByText("Finalized").first()).toBeVisible();
    await expect(page.locator("text=/INV-\\d{4}-\\d{6}/").first()).toBeVisible();
  });

  test("customer sees the finalized manifest and the new invoice", async ({ page }) => {
    await signIn(page, "corporate@abc-group.demo.test");
    await page.goto("/customer/manifests");
    await expect(page.locator("tbody tr").first()).toContainText(/1,180 gal|gal/);
    await page.goto("/customer/invoices?status=OPEN");
    await expect(page.locator("tbody tr").first()).toContainText("INV-");
  });

  test("dispatcher can assign the unassigned job from the dispatch board", async ({ page }) => {
    await signIn(page, "dispatch@demo.sewersquad.test");
    await page.goto("/admin/jobs?status=UNASSIGNED");
    await page.locator("tbody tr").first().getByRole("link", { name: /^J-/ }).click();
    await expect(page).toHaveURL(/\/admin\/jobs\/[0-9a-f-]{36}/, { timeout: 90_000 });
    await page.getByRole("combobox", { name: "Driver" }).selectOption({ label: "Sam Whitaker" });
    await page.getByRole("combobox", { name: "Truck" }).selectOption({ label: "T-102" });
    await page.getByRole("button", { name: "Save" }).first().click();
    await expect(page.getByText("Assigned — driver notified.")).toBeVisible();
  });
});
