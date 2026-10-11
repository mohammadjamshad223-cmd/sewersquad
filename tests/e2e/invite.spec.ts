import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("without an email provider, the inviting admin gets a one-time link the invitee can use", async ({ browser }) => {
  const admin = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await admin.newPage();
  await signIn(page, "owner@demo.sewersquad.test");
  await page.goto("/admin/settings?tab=staff");
  await page.getByRole("button", { name: "Invite staff" }).click();
  const dialog = page.getByRole("dialog");
  const email = `new.dispatch.${Date.now()}@demo.sewersquad.test`;
  await dialog.getByLabel("Name").fill("Casey New");
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`share this one-time invitation link with ${email}`)).toBeVisible();
  await page.getByRole("button", { name: "Copy link" }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/\/invite\/accept\?token=/);
  await admin.close();

  const invitee = await browser.newContext();
  const p = await invitee.newPage();
  await p.goto(link);
  await p.getByLabel("New password").fill("Casey-new-pass-2026");
  await p.getByLabel("Confirm password").fill("Casey-new-pass-2026");
  await p.getByRole("button", { name: "Create account" }).click();
  await expect(p).toHaveURL(/\/admin/);
  // The link is single use.
  const again = await (await browser.newContext()).newPage();
  await again.goto(link);
  await expect(again.getByText(/invalid|expired|already/i).first()).toBeVisible();
  await invitee.close();
});
