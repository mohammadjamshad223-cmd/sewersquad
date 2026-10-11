import { chromium } from "@playwright/test";
const jobId = process.argv[2];
const SP = process.argv[3];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, permissions: [] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://localhost:3000/login");
await page.screenshot({ path: `${SP}/photo.png` }); // any PNG works as a test photo
await page.fill('input[name="email"]', "driver.luis@demo.sewersquad.test");
await page.fill('input[name="password"]', "SewerSquad-demo-2026");
await page.click('button[type="submit"]');
await page.waitForURL("**/driver/dashboard");
await page.goto(`http://localhost:3000/driver/jobs/${jobId}`);
await page.goto(`http://localhost:3000/driver/jobs/${jobId}/complete`);
const next = () => page.getByRole("button", { name: /^Next/ }).click();
await next(); // arrival -> before
await page.locator('input[type=file]').setInputFiles(`${SP}/photo.png`);
await page.locator("text=Pending").or(page.locator('img[alt="before photo"]')).first().waitFor({ timeout: 30000 });
await page.getByLabel("Equipment condition").fill("Thick grease cap, baffles intact");
await next(); // -> pumping
await page.locator("#waste").selectOption("Grease trap waste");
await page.getByLabel("Actual gallons pumped").first().fill("1320");
await next(); // -> after
await page.locator('input[type=file]').setInputFiles(`${SP}/photo.png`);
await page.locator('img[alt="after photo"]').first().waitFor({ timeout: 30000 });
await page.getByLabel("Condition after pumping").fill("Pumped to bottom");
await next(); // -> manifest
await next(); // -> signatures
await page.getByLabel("Representative name").fill("Jamie Kitchen");
const sign = async (label) => {
  const c = page.getByRole("img", { name: new RegExp(label) });
  await c.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const b = await c.boundingBox();
  await page.mouse.move(b.x + 20, b.y + 60); await page.mouse.down();
  for (let i = 0; i < 12; i++) await page.mouse.move(b.x + 30 + i * 20, b.y + 50 + (i % 2) * 40);
  await page.mouse.up();
};
await sign("Customer signature");
await sign("Your signature");
await page.locator('input[name="certify"]').check();
await page.getByRole("button", { name: /Review & submit/ }).click();
await page.getByText("Ready to submit").waitFor({ timeout: 30000 });
await page.screenshot({ path: `${SP}/pre-submit.png`, fullPage: true });
await page.getByRole("button", { name: /^Submit job/ }).click();
await page.waitForURL(`**/driver/jobs/${jobId}?submitted=1`, { timeout: 30000 });
await page.screenshot({ path: `${SP}/after-submit.png`, fullPage: true });
console.log("DONE", page.url(), "errors:", JSON.stringify(errors));
await browser.close();
