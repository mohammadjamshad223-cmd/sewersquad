import { expect, test } from "@playwright/test";
import { noHorizontalScroll, signIn } from "./helpers";

// Workflow A field portion on a phone viewport; the admin + customer half runs in workflow-review.spec.ts.
test("Workflow A (driver, mobile): complete today's first stop with photos, gallons and signatures", async ({ page }) => {
  await signIn(page, "driver.luis@demo.sewersquad.test");
  await expect(page.getByRole("heading", { name: /Hi, Luis/ })).toBeVisible();
  await noHorizontalScroll(page);
  await page.getByRole("button", { name: /Start — en route/ }).click();
  await page.getByRole("button", { name: /I've arrived/ }).click();
  await expect(page).toHaveURL(/\/complete$/);
  const next = () => page.getByRole("button", { name: /^Next/ }).click();

  await next(); // → Before
  const photo = { name: "before.png", mimeType: "image/png", buffer: Buffer.from("89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6360000002000154A24F5D0000000049454E44AE426082", "hex") };
  await page.locator("input[type=file]").setInputFiles(photo);
  await expect(page.getByRole("img", { name: "before photo" })).toBeVisible();
  await page.getByLabel("Equipment condition").fill("Grease cap ~6 in.");
  await next(); // → Pumping
  await page.locator("#waste").selectOption("Grease trap waste");
  await page.getByLabel("Actual gallons pumped").first().fill("1180");
  await next(); // → After
  await page.locator("input[type=file]").setInputFiles({ ...photo, name: "after.png" });
  await expect(page.getByRole("img", { name: "after photo" })).toBeVisible();
  await next(); // → Manifest
  await expect(page.getByText("1,180").first()).toBeVisible();
  await next(); // → Signatures
  await page.getByLabel("Representative name").fill("E2E Manager");
  for (const label of ["Customer signature", "Your signature"]) {
    const pad = page.getByRole("img", { name: new RegExp(label) });
    await pad.evaluate((el) => el.scrollIntoView({ block: "center" }));
    const b = (await pad.boundingBox())!;
    await page.mouse.move(b.x + 20, b.y + 60);
    await page.mouse.down();
    for (let i = 0; i < 10; i++) await page.mouse.move(b.x + 30 + i * 18, b.y + 40 + (i % 2) * 50);
    await page.mouse.up();
  }
  await page.locator('input[name="certify"]').check();
  await page.getByRole("button", { name: /Review & submit/ }).click();
  await expect(page.getByText("Ready to submit")).toBeVisible();
  await page.getByRole("button", { name: /^Submit job/ }).click();
  await expect(page).toHaveURL(/submitted=1/);
  await expect(page.getByText("Submitted for Review").first()).toBeVisible();
});
