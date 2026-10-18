import { chromium, type FullConfig } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import fs from "node:fs";

// Creates a throwaway owner account for the admin tests (local/test databases only) and signs it in.
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL ?? "http://localhost:3000";
  if (/digitaldistrict\.store/.test(baseURL)) throw new Error("Refusing to create test accounts against production.");
  const password = `E2e-${randomBytes(9).toString("base64url")}1`;
  const db = new PrismaClient();
  await db.user.upsert({
    where: { email: "e2e-owner@test.local" },
    create: { email: "e2e-owner@test.local", name: "E2E Owner", role: "OWNER", passwordHash: await bcrypt.hash(password, 10) },
    update: { role: "OWNER", isActive: true, passwordHash: await bcrypt.hash(password, 10), totpEnabledAt: null, totpSecret: null },
  });
  await db.$disconnect();
  const browser = await chromium.launch(config.projects[0].use.launchOptions);
  const page = await browser.newPage({ baseURL });
  await page.goto("/login?next=/admin");
  await page.getByLabel("Email").fill("e2e-owner@test.local");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/admin"));
  fs.mkdirSync("test-results", { recursive: true });
  await page.context().storageState({ path: "test-results/owner-state.json" });
  await browser.close();
}
