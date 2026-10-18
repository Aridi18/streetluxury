import { expect, test } from "@playwright/test";

test("guest can search, add a plan to the cart and place a website order", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goto("/shop?q=netflix");
  await page.getByRole("link", { name: "Netflix", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Netflix", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "3 Months" }).click();
  await expect(page.getByText("$9.50").first()).toBeVisible();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to your cart.")).toBeVisible();

  await page.goto("/cart");
  await expect(page.getByText("3 Months")).toBeVisible();
  await page.getByRole("link", { name: "Checkout" }).click();
  await page.getByLabel("Full name").fill("E2E Test Customer");
  await page.getByLabel("Phone / WhatsApp").fill("70 123 456");
  await page.getByLabel(/I agree to the/).check();
  await page.getByRole("button", { name: "Place order" }).click();

  await expect(page).toHaveURL(/\/order\/DD-\d+\?key=/);
  await expect(page.getByText("Thank you! Your order has been received.")).toBeVisible();
  await expect(page.getByText("Pending confirmation").first()).toBeVisible();
  await expect(page.getByText("$9.50").first()).toBeVisible();
});

test("WhatsApp checkout saves a pending order and prepares an encoded message", async ({ page }) => {
  await page.goto("/product/spotify-premium");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to your cart.")).toBeVisible();
  await page.goto("/checkout?mode=whatsapp");
  await page.getByLabel("Full name").fill("WhatsApp Buyer");
  await page.getByLabel("Phone / WhatsApp").fill("+961 3 123 456");
  await page.getByLabel(/I agree to the/).check();
  await page.getByRole("button", { name: "Continue to WhatsApp" }).click();
  await expect(page).toHaveURL(/wa=1/);
  await expect(page.getByRole("heading", { name: /Send your order on WhatsApp/ })).toBeVisible();
  const link = await page.getByRole("link", { name: "Open WhatsApp" }).getAttribute("href");
  expect(link).toMatch(/^https:\/\/wa\.me\/96181745567\?text=/);
  const text = decodeURIComponent(link!.split("text=")[1]);
  expect(text).toContain("Spotify Premium");
  expect(text).toMatch(/Order reference: DD-\d+/);
});

test("order pages are private without the access key", async ({ page }) => {
  const res = await page.goto("/order/DD-100001");
  expect(res?.status()).toBe(404);
});

test("admin requires sign-in", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login/);
});
