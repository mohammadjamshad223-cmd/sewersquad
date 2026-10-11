import { expect, test } from "@playwright/test";
import { noHorizontalScroll, signIn } from "./helpers";

test.describe("customer portal", () => {
  test("Workflow D: corporate account filters by location and returns to consolidated view", async ({ page }) => {
    await signIn(page, "corporate@abc-group.demo.test");
    await expect(page.getByRole("heading", { name: /Welcome back, Priya/ })).toBeVisible();
    await expect(page.getByText("All 4 locations")).toBeVisible();
    const switcher = page.getByRole("combobox", { name: "Location" });
    await switcher.selectOption({ label: "ABC Restaurant — Katy · Katy" });
    await expect(page.getByText("Your Sewer Squad account at a glance · ABC Restaurant — Katy")).toBeVisible();
    await page.goto("/customer/services");
    await expect(page.locator("tbody tr").first()).toContainText("Katy");
    await expect(page.locator("tbody")).not.toContainText("Downtown");
    await page.goto("/customer/dashboard");
    await page.getByRole("combobox", { name: "Location" }).selectOption({ label: "All locations (4)" });
    await expect(page.getByText("All 4 locations")).toBeVisible();
    await noHorizontalScroll(page);
  });

  test("Workflow C: retrieve a historical manifest PDF and its invoice", async ({ page }) => {
    await signIn(page, "corporate@abc-group.demo.test");
    await page.goto("/customer/history");
    const row = page.locator("tbody tr").filter({ has: page.getByRole("link", { name: /^MF-/ }) }).first();
    const manifestLink = row.getByRole("link", { name: /^MF-/ });
    const href = await manifestLink.getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
    await row.getByRole("link", { name: /^INV-/ }).click();
    await expect(page.getByRole("heading", { name: /Invoice INV-/ })).toBeVisible();
    await expect(page.getByText("Balance due")).toBeVisible();
  });

  test("customers cannot fetch documents from other organizations by ID", async ({ page }) => {
    await signIn(page, "owner@bayou-taqueria.demo.test");
    // An ABC Restaurant Group document id, discovered as that customer:
    const ctx = await page.context().browser()!.newContext();
    const other = await ctx.newPage();
    await signIn(other, "corporate@abc-group.demo.test");
    await other.goto("/customer/manifests");
    const href = await other.getByRole("link", { name: "PDF" }).first().getAttribute("href");
    await ctx.close();
    const res = await page.request.get(href!);
    expect(res.status()).toBe(404);
  });

  test("Workflow B (customer side): submit an emergency request and track it", async ({ page }) => {
    await signIn(page, "katy.manager@abc-group.demo.test");
    await page.goto("/customer/request-service");
    await expect(page.getByText("Online submission does not guarantee immediate dispatch")).toBeVisible();
    await page.getByLabel("Description").fill("E2E: grease backing up through the floor drain by the fryer.");
    await page.getByLabel("Contact phone").fill("(281) 555-0612");
    await page.getByRole("button", { name: "Submit emergency request" }).click();
    await expect(page).toHaveURL(/\/customer\/request-service\/[0-9a-f-]+\?submitted=1/);
    await expect(page.getByText("Request received")).toBeVisible();
    await expect(page.getByText("Not yet confirmed").first()).toBeVisible();
  });

  test("read-only users see invoices but no pay controls", async ({ page }) => {
    await signIn(page, "viewer@abc-group.demo.test");
    await page.goto("/customer/invoices");
    await expect(page.getByRole("heading", { name: "Invoices & payments" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pay selected" })).toHaveCount(0);
  });
});
