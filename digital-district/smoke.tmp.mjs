import { chromium } from "@playwright/test";
const SP = "/tmp/claude-0/-home-user-streetluxury/f81d7302-af7e-5be5-8e4b-a8a985374a92/scratchpad";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ storageState: `${SP}/admin-state.json` });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
const paths = process.argv.slice(2);
for (const p of paths) {
  errs.length = 0;
  const res = await page.goto(`http://localhost:3000${p}`, { waitUntil: "load" });
  const text = await page.locator("body").innerText();
  const bad = /Something went wrong|Unhandled Runtime Error|Application error/.test(text);
  console.log(`${res.status()} ${bad ? "ERROR-PAGE" : "ok"} ${p} ${errs.length ? "JS:" + errs[0] : ""}`);
}
await browser.close();
