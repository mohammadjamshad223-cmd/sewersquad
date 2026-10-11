import { chromium } from "@playwright/test";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://localhost:3000/login");
await page.fill('input[name="email"]', "corporate@abc-group.demo.test");
await page.fill('input[name="password"]', "SewerSquad-demo-2026");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/login"));
await page.goto("http://localhost:3000" + process.argv[2], { waitUntil: "networkidle" });
console.log(await page.evaluate(() => {
  const W = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.right > W + 1 && !el.closest("table")) {
      let p = el.parentElement, clipped = false;
      while (p) { const s = getComputedStyle(p); if (s.overflowX !== "visible") { clipped = true; break; } p = p.parentElement; }
      if (true) out.push(`${el.tagName}.${(el.className||"").toString().slice(0,60)} right=${Math.round(r.right)}`);
    }
  }
  return out.slice(0, 8).join("\n") || "none";
}));
await browser.close();
