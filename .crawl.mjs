import { chromium } from "@playwright/test";
const [,, email, pathsCsv, shotDir, width] = process.argv;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: Number(width || 1440), height: 900 } });
const page = await ctx.newPage();
let errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
await page.goto("http://localhost:3000/login");
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', "SewerSquad-demo-2026");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90000 });
for (const p of pathsCsv.split(",")) {
  errors = [];
  const res = await page.goto("http://localhost:3000" + p, { waitUntil: "networkidle", timeout: 120000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const h1 = await page.locator("h1").first().textContent().catch(() => "");
  console.log(`${res?.status()} ${p} -> ${new URL(page.url()).pathname} | h1="${(h1||"").trim().slice(0,50)}" ${overflow ? "OVERFLOW" : ""} ${errors.length ? "ERR " + JSON.stringify(errors.slice(0,2)) : ""}`);
  if (shotDir) await page.screenshot({ path: `${shotDir}/${p.replace(/\W+/g, "_")}.png`, fullPage: true });
}
await browser.close();
