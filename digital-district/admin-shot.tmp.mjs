import { chromium } from "@playwright/test";
import fs from "node:fs";
const [,, mode, ...rest] = process.argv;
const SP = "/tmp/claude-0/-home-user-streetluxury/f81d7302-af7e-5be5-8e4b-a8a985374a92/scratchpad";
const state = `${SP}/admin-state.json`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: fs.existsSync(state) ? state : undefined });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
if (mode === "invite") {
  const [url, email, pw] = rest;
  await page.goto(url);
  await page.getByLabel("Your name").fill("Owner");
  await page.getByLabel("Password", { exact: true }).fill(pw);
  await page.getByLabel("Confirm password").fill(pw);
  await page.getByRole("button", { name: "Create admin account" }).click();
  await page.getByText("Your admin account is ready").waitFor();
  await page.goto("/login".replace(/^/, new URL(url).origin));
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pw);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin/);
  await ctx.storageState({ path: state });
  console.log("logged in", page.url());
} else {
  for (const [url, out] of rest.map((x) => x.split("|"))) {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SP}/shots/${out}.png`, fullPage: true });
    console.log(out, page.url());
  }
}
if (errors.length) console.log("ERRORS:", errors.slice(0, 5).join("\n"));
await browser.close();
