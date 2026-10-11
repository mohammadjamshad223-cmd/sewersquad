import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const PNG = Buffer.from("89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6360000002000154A24F5D0000000049454E44AE426082", "hex");

test.describe("owner-operator", () => {
  test("the owner turns on field mode and can open the driver screens", async ({ page }) => {
    await signIn(page, "owner@demo.sewersquad.test");
    await page.goto("/admin/settings?tab=staff");
    await page.getByRole("row", { name: /owner@demo\.sewersquad\.test/ }).getByRole("button", { name: "Enable field mode" }).click();
    await expect(page.getByText("Field mode on")).toBeVisible();
    await page.reload();
    await page.getByRole("link", { name: "My Route (field mode)" }).click();
    await expect(page).toHaveURL(/\/driver\/dashboard/);
    await page.getByRole("link", { name: "Office" }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/);
  });

  test("the office attaches a photo and a document to a completed job", async ({ page }) => {
    await signIn(page, "owner@demo.sewersquad.test");
    await page.goto("/admin/jobs?status=COMPLETED");
    await page.locator("table a[href^='/admin/jobs/']").first().click();
    await expect(page.getByRole("heading", { name: "Add photos & files" })).toBeVisible();
    await page.getByLabel("What are you adding?").selectOption("AFTER");
    await page.locator("input[name=files]").setInputFiles({ name: "after.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Add to job" }).click();
    await expect(page.getByText("1 file added to the job.")).toBeVisible();
    await page.getByLabel("What are you adding?").selectOption("DOCUMENT");
    await page.getByLabel(/^Title/).fill("City inspection report");
    await page.locator("input[name=files]").setInputFiles({ name: "report.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Add to job" }).click();
    await expect(page.getByText("City inspection report").first()).toBeVisible();
  });
});
