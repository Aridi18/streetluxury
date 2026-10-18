import { expect, test, type Browser } from "@playwright/test";
import sharp from "sharp";


const ownerContext = (browser: Browser) => browser.newContext({ storageState: "test-results/owner-state.json" });

test("owner creates a physical product with stock and it appears in the store", async ({ browser, page }) => {
  const admin = await (await ownerContext(browser)).newPage();
  const name = `E2E Headset ${Date.now()}`;
  await admin.goto("/admin/products/new");
  await admin.getByLabel("Product name").fill(name);
  await admin.getByLabel("What are you selling?").selectOption("PHYSICAL");
  await admin.getByLabel("Selling price (USD)").fill("49.99");
  await admin.getByLabel("Your cost (USD)").fill("30");
  await admin.getByLabel("Stock quantity").fill("3");
  await admin.getByLabel("Short description").fill("Wireless gaming headset");
  await admin.getByLabel(/Publish now/).check();
  await admin.getByRole("button", { name: "Create product" }).click();
  await expect(admin.getByText("Product created.")).toBeVisible();
  // Upload a photo (decoded, resized and converted on the server).
  const photo = await sharp({ create: { width: 900, height: 700, channels: 3, background: "#7c3aed" } }).png().toBuffer();
  await admin.getByLabel("Photos").setInputFiles({ name: "headset.png", mimeType: "image/png", buffer: photo });
  await admin.getByRole("button", { name: "Upload photos" }).click();
  await expect(admin.getByText("1 image(s) uploaded.")).toBeVisible();
  // A non-image disguised as an image is rejected.
  await admin.getByLabel("Photos").setInputFiles({ name: "evil.png", mimeType: "image/png", buffer: Buffer.from("<script>alert(1)</script>") });
  await admin.getByRole("button", { name: "Upload photos" }).click();
  await expect(admin.getByText(/not a supported image/)).toBeVisible();

  await page.goto(`/shop?q=${encodeURIComponent(name)}`);
  await expect(page.getByRole("link", { name, exact: true }).first()).toBeVisible();
  await expect(page.getByText("$49.99").first()).toBeVisible();
  const img = page.locator(`img[alt="${name}"]`).first();
  await expect(img).toBeVisible();
  const src = await img.getAttribute("src");
  expect((await page.request.get(src!)).headers()["content-type"]).toBe("image/webp");

  await admin.goto("/admin/inventory?q=" + encodeURIComponent(name));
  await expect(admin.getByRole("row", { name: new RegExp(name) }).locator("td").nth(2)).toHaveText("3");
});

test("customer order → staff records payment and delivers → customer sees access details", async ({ browser, page }) => {
  // Customer places a website order with the "confirm on WhatsApp" method.
  await page.goto("/product/disney-plus");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to your cart.")).toBeVisible();
  await page.goto("/checkout");
  await page.getByLabel("Full name").fill("Delivery Test");
  await page.getByLabel("Phone / WhatsApp").fill("71 222 333");
  await page.getByLabel(/I agree to the/).check();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page).toHaveURL(/\/order\/DD-\d+\?key=/);
  const orderUrl = page.url();
  const number = orderUrl.match(/DD-\d+/)![0];

  // Staff finds the order, records the payment and delivers.
  const admin = await (await ownerContext(browser)).newPage();
  await admin.goto(`/admin/orders?q=${number}`);
  await admin.getByRole("link", { name: number }).click();
  await admin.getByText("Record a payment received").click();
  await admin.getByRole("button", { name: "Record payment" }).click();
  await expect(admin.getByText(/Confirm payment on WhatsApp\s*succeeded/)).toBeVisible();
  await admin.getByLabel("Details the customer will see").fill("Profile: DD-Test · PIN 4321");
  await admin.getByRole("button", { name: "Mark as delivered" }).click();
  await expect(admin.getByText("Profile: DD-Test · PIN 4321")).toBeVisible();

  await page.goto(orderUrl);
  await expect(page.getByText("Profile: DD-Test · PIN 4321")).toBeVisible();
  await expect(page.getByText("Completed").first()).toBeVisible();
});

test("owner creates a coupon and the cart applies it", async ({ browser, page }) => {
  const admin = await (await ownerContext(browser)).newPage();
  const code = `SAVE${Date.now().toString().slice(-6)}`;
  await admin.goto("/admin/promotions");
  await admin.getByLabel("Name").first().fill("E2E coupon");
  await admin.getByLabel("Coupon code").first().fill(code);
  await admin.getByLabel("Value").first().fill("10");
  await admin.getByRole("button", { name: "Create promotion" }).click();
  await expect(admin.getByText("Promotion saved.")).toBeVisible();

  await page.goto("/product/spotify-premium");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await expect(page.getByText("Added to your cart.")).toBeVisible();
  await page.goto("/cart");
  await page.getByLabel("Discount code").fill(code);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(`Code ${code}`)).toBeVisible();
  await expect(page.getByText("Applied")).toBeVisible();
});

test("non-staff users cannot reach admin pages or actions", async ({ page }) => {
  await page.goto("/register");
  await page.locator("#name").fill("Normal Customer");
  await page.locator("#email").fill(`customer-${Date.now()}@test.local`);
  await page.locator("#password").fill("CustomerPass123");
  await page.locator("#confirm").fill("CustomerPass123");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/account/);
  await page.goto("/admin/orders");
  await expect(page).not.toHaveURL(/\/admin/);
  const res = await page.request.get("/api/admin/export/orders");
  expect(res.status()).toBe(403);
});
