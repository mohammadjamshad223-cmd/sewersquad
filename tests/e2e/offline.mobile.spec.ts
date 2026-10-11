import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const PHOTO = { name: "offline.png", mimeType: "image/png", buffer: Buffer.from("89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6360000002000154A24F5D0000000049454E44AE426082", "hex") };

/**
 * Offline drafts: with the network cut mid-job, the driver keeps working; the draft and photo are
 * stored (encrypted) on the device, survive a reload, and sync when connectivity returns.
 */
test("driver work survives going offline and syncs on reconnect", async ({ page, context }) => {
  await signIn(page, "driver.dana@demo.sewersquad.test");
  await page.getByRole("button", { name: /Start — en route/ }).click();
  await page.getByRole("button", { name: /I've arrived/ }).click();
  await expect(page).toHaveURL(/\/complete$/);
  const next = () => page.getByRole("button", { name: /^Next/ }).click();
  await next(); // Before

  await context.setOffline(true);
  await page.locator("input[type=file]").setInputFiles(PHOTO);
  await expect(page.getByText("Pending").first()).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /Offline — saved on this device/ })).toBeVisible();
  await page.getByLabel("Equipment condition").fill("Typed while offline");
  await page.waitForTimeout(800); // local (encrypted) save debounce

  // Reload while still offline is not possible (no service worker), so reconnect and reload:
  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: /All changes saved/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Pending")).toHaveCount(0, { timeout: 30_000 });
  await page.reload();
  await page.getByRole("button", { name: /Step 2: Before/ }).click();
  await expect(page.getByLabel("Equipment condition")).toHaveValue("Typed while offline");
  await expect(page.getByRole("img", { name: "before photo" })).toHaveCount(1);
});
