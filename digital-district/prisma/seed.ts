// Seeds a new Digital District database with the real catalog exported from the previous storefront,
// the store's contact details, FAQs and policies, and safe defaults for payments, delivery and accounting.
// Safe to run more than once: existing records (matched by slug/code/name) are left untouched,
// so edits made in the admin panel are never overwritten.
import { PrismaClient, type PaymentAppliesTo, type PaymentMethodKind, type ProductType } from "@prisma/client";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, type StoreSettings } from "../src/lib/settings";

const db = new PrismaClient();

type LegacyPlan = { name: string; duration: string | null; accountType: string | null; price: number; salePrice: number | null; position: number; active: boolean };
type LegacyProduct = {
  name: string; slug: string; category: string; shortDescription: string | null; description: string | null; importantInfo: string | null;
  badge: string | null; featured: boolean; bestseller: boolean; onRequest: boolean; active: boolean; position: number; brandDomain: string | null;
  seoTitle: string | null; seoDescription: string | null; createdAt: string; plans: LegacyPlan[];
};
type Legacy = {
  categories: { name: string; slug: string; description: string | null; icon: string | null; position: number; active: boolean }[];
  products: LegacyProduct[];
  settings: Record<string, string>;
  faqs: { q: string; a: string }[];
};

const legacy: Legacy = JSON.parse(readFileSync(path.join(import.meta.dirname, "seed-data/legacy-catalog.json"), "utf8"));

const BRANDS: Record<string, string> = {
  "openai.com": "OpenAI", "gemini.google.com": "Google", "claude.ai": "Anthropic", "perplexity.ai": "Perplexity", "elevenlabs.io": "ElevenLabs",
  "leonardo.ai": "Leonardo.Ai", "x.ai": "xAI", "cursor.com": "Cursor", "autodesk.com": "Autodesk", "zoom.us": "Zoom", "canva.com": "Canva",
  "adobe.com": "Adobe", "capcut.com": "CapCut", "figma.com": "Figma", "freepik.com": "Freepik", "elements.envato.com": "Envato",
  "coursera.org": "Coursera", "linkedin.com": "LinkedIn", "duolingo.com": "Duolingo", "playstation.com": "PlayStation", "xbox.com": "Xbox",
  "store.steampowered.com": "Steam", "epicgames.com": "Epic Games", "play.google.com": "Google Play", "microsoft.com": "Microsoft",
  "onedrive.live.com": "Microsoft", "spotify.com": "Spotify", "music.youtube.com": "YouTube", "anghami.com": "Anghami", "music.apple.com": "Apple",
  "tv.apple.com": "Apple", "instagram.com": "Instagram", "tiktok.com": "TikTok", "netflix.com": "Netflix", "disneyplus.com": "Disney+",
  "primevideo.com": "Amazon Prime Video", "shahid.mbc.net": "Shahid", "osnplus.com": "OSN+", "tod.tv": "TOD", "paramountplus.com": "Paramount+",
  "hbomax.com": "HBO Max", "crunchyroll.com": "Crunchyroll", "nordvpn.com": "NordVPN", "expressvpn.com": "ExpressVPN", "cyberghostvpn.com": "CyberGhost",
};

function slugify(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
}

function productType(p: LegacyProduct): ProductType {
  if (p.category === "social-media" || p.category === "web-development") return "SERVICE";
  if (p.category === "gaming") return "DIGITAL";
  if (p.category === "microsoft" && !/365|onedrive/i.test(p.name)) return "LICENSE";
  return "SUBSCRIPTION";
}

function durationDays(duration: string | null): number | null {
  if (!duration) return null;
  const m = /(\d+)\s*(day|week|month|year)/i.exec(duration);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return unit === "day" ? n : unit === "week" ? n * 7 : unit === "month" ? n * 30 : n * 365;
}

const cents = (usd: number) => Math.round(usd * 100);

async function seedSettings() {
  const existing = await db.setting.findUnique({ where: { key: "store" } });
  if (existing) return;
  const s = legacy.settings;
  const settings: StoreSettings = {
    ...DEFAULT_SETTINGS,
    storeName: s.business_name || "Digital District",
    domain: s.domain || "digitaldistrict.store",
    whatsappNumber: (s.whatsapp_number || "96181745567").replace(/\D/g, ""),
    phoneDisplay: s.whatsapp_display || "+961 81 745 567",
    supportEmail: s.support_email || "",
    instagramUrl: s.instagram_url || "",
    facebookUrl: s.facebook_url || "",
    tiktokUrl: s.tiktok_url || "",
    currency: s.currency || "USD",
    announcement: s.announcement || "",
    announcementEnabled: Boolean(s.announcement),
    heroTitle: s.hero_title || DEFAULT_SETTINGS.heroTitle,
    heroSubtitle: s.hero_subtitle || "",
    whatsappDefaultMessage: s.whatsapp_default_message || DEFAULT_SETTINGS.whatsappDefaultMessage,
    seoTitle: "Digital District — Premium Digital Subscriptions & Software",
    seoDescription: "Buy Netflix, Spotify, ChatGPT, Adobe, Windows, VPN and gaming subscriptions at the best prices in Lebanon. Fast WhatsApp delivery and real support.",
    benefits: [
      { icon: "zap", title: "Fast delivery", text: "Most orders are activated within minutes of confirmation." },
      { icon: "shield", title: "Warranty on every plan", text: "Replacement or fix for the full duration you paid for." },
      { icon: "message", title: "Real human support", text: "Talk to us on WhatsApp before, during and after your purchase." },
      { icon: "lock", title: "Secure checkout", text: "Your order details are protected, and payments are verified by our team." },
    ],
    howItWorks: [
      { title: "Choose your plan", text: "Pick a product and the duration or plan that suits you." },
      { title: "Order on the website or WhatsApp", text: "Check out in a few taps, or send your cart to us on WhatsApp in one tap." },
      { title: "Get activated", text: "Pay, receive your access details and start using it right away." },
    ],
  };
  await db.setting.create({ data: { key: "store", value: settings } });
}

async function seedCatalog() {
  const categoryIds = new Map<string, string>();
  for (const c of legacy.categories) {
    const row = await db.category.upsert({
      where: { slug: c.slug },
      create: { name: c.name, slug: c.slug, description: c.description, icon: c.icon, sortOrder: c.position, isVisible: c.active },
      update: {},
    });
    categoryIds.set(c.slug, row.id);
  }
  // Additional categories requested for the new store. They stay out of the menu until they contain products.
  const extra: { name: string; icon: string; parent?: string }[] = [
    { name: "Electronics", icon: "Cpu" },
    { name: "Computers & Laptop Accessories", icon: "Laptop" },
    { name: "Phones & Mobile Accessories", icon: "Smartphone" },
    { name: "Networking Equipment", icon: "Router" },
    { name: "Gaming Accessories", icon: "Gamepad2", parent: "gaming" },
    { name: "Office & Productivity", icon: "Briefcase" },
    { name: "Physical Accessories", icon: "Package" },
    { name: "Other Services on Request", icon: "MessageCircle" },
  ];
  let order = 100;
  for (const c of extra) {
    const slug = slugify(c.name);
    await db.category.upsert({
      where: { slug },
      create: { name: c.name, slug, icon: c.icon, sortOrder: order++, parentId: c.parent ? categoryIds.get(c.parent) : null },
      update: {},
    });
  }

  const brandIds = new Map<string, string>();
  for (const [domain, name] of Object.entries(BRANDS)) {
    if (brandIds.has(name)) continue;
    const row = await db.brand.upsert({ where: { slug: slugify(name) }, create: { name, slug: slugify(name), website: `https://${domain}` }, update: {} });
    brandIds.set(name, row.id);
  }

  let created = 0;
  for (const p of legacy.products) {
    if (await db.product.findUnique({ where: { slug: p.slug } })) continue;
    const type = productType(p);
    const brandName = p.brandDomain ? BRANDS[p.brandDomain] : undefined;
    const description = [p.description, p.importantInfo ? `**Important:** ${p.importantInfo}` : null].filter(Boolean).join("\n\n");
    const variants = p.onRequest
      ? []
      : p.plans.map((plan, i) => {
          const onSale = plan.salePrice != null && plan.salePrice < plan.price;
          return {
            sku: `${p.slug.toUpperCase()}-${i + 1}`,
            name: plan.name,
            optionValues: { Plan: plan.name },
            price: cents(onSale ? plan.salePrice! : plan.price),
            compareAtPrice: onSale ? cents(plan.price) : null,
            costPrice: 0,
            trackInventory: false,
            durationDays: durationDays(plan.duration),
            isDefault: i === 0,
            isActive: plan.active,
            sortOrder: plan.position,
          };
        });
    const prices = variants.map((v) => v.price);
    await db.product.create({
      data: {
        title: p.name,
        slug: p.slug,
        shortDescription: p.shortDescription,
        description,
        type,
        status: p.active ? "ACTIVE" : "HIDDEN",
        categoryId: categoryIds.get(p.category),
        brandId: brandName ? brandIds.get(brandName) : null,
        badge: p.badge,
        isFeatured: p.featured,
        isBestseller: p.bestseller,
        isOnRequest: p.onRequest,
        deliveryMethod: type === "SERVICE" ? "Delivered by our team after confirmation" : "Digital delivery on WhatsApp, email or your order page",
        deliveryEstimate: p.onRequest ? "Quoted on request" : "Usually within minutes to a few hours after payment confirmation",
        digitalDeliveryMode: "MANUAL",
        warranty: type === "SUBSCRIPTION" ? "Covered for the full duration of your plan. If it stops working through no fault of yours, we repair or replace it." : null,
        sortOrder: p.position,
        seoTitle: p.seoTitle,
        seoDescription: p.seoDescription,
        customFields: [],
        minPrice: prices.length ? Math.min(...prices) : 0,
        maxPrice: prices.length ? Math.max(...prices) : 0,
        inStock: true,
        hasCompareAt: variants.some((v) => v.compareAtPrice != null),
        publishedAt: new Date(p.createdAt),
        createdAt: new Date(p.createdAt),
        variants: { create: variants },
      },
    });
    created++;
  }
  return created;
}

async function seedPaymentMethods() {
  const methods: { code: string; name: string; kind: PaymentMethodKind; description: string; instructions: string; isEnabled: boolean; appliesTo?: PaymentAppliesTo; requiresReference?: boolean; allowProofUpload?: boolean; sortOrder: number }[] = [
    {
      code: "whatsapp",
      name: "Confirm payment on WhatsApp",
      kind: "ARRANGED",
      description: "We confirm your order and agree on payment with you on WhatsApp.",
      instructions: "Our team will contact you on WhatsApp to confirm availability and agree on payment (for example Whish Money, OMT, USDT or cash). Nothing is charged on this website.",
      isEnabled: true,
      sortOrder: 1,
    },
    { code: "whish", name: "Whish Money", kind: "MANUAL", description: "Send the amount with Whish Money, then enter the transaction reference.", instructions: "", isEnabled: false, requiresReference: true, allowProofUpload: true, sortOrder: 2 },
    { code: "omt", name: "OMT", kind: "MANUAL", description: "Send the amount through OMT, then enter the transfer reference.", instructions: "", isEnabled: false, requiresReference: true, allowProofUpload: true, sortOrder: 3 },
    { code: "usdt", name: "USDT", kind: "MANUAL", description: "Pay with USDT, then enter the transaction hash.", instructions: "", isEnabled: false, requiresReference: true, allowProofUpload: true, sortOrder: 4 },
    { code: "bank", name: "Bank transfer", kind: "MANUAL", description: "Transfer to our bank account, then upload the receipt.", instructions: "", isEnabled: false, requiresReference: false, allowProofUpload: true, sortOrder: 5 },
    { code: "cod", name: "Cash on delivery", kind: "CASH_ON_DELIVERY", description: "Pay the courier in cash when your order arrives.", instructions: "Please have the exact amount ready in cash when the courier arrives.", isEnabled: true, appliesTo: "PHYSICAL_ONLY", sortOrder: 6 },
    { code: "card", name: "Credit or debit card", kind: "ONLINE_CARD", description: "Pay securely on the bank's hosted payment page.", instructions: "You will be redirected to the bank's secure payment page. We never see or store your card details.", isEnabled: false, sortOrder: 7 },
  ];
  for (const m of methods) await db.paymentMethod.upsert({ where: { code: m.code }, create: m, update: {} });
}

async function seedShippingZones() {
  if ((await db.shippingZone.count()) > 0) return;
  const zones = ["Beirut", "Mount Lebanon", "North Lebanon", "Akkar", "Bekaa", "Baalbek-Hermel", "South Lebanon", "Nabatieh"];
  // Created inactive with no fee: the owner sets real delivery fees before enabling physical delivery.
  await db.shippingZone.createMany({ data: zones.map((name, i) => ({ name, areas: [], fee: 0, isActive: false, sortOrder: i + 1 })) });
}

async function seedExpenseCategories() {
  const cats: [string, boolean][] = [
    ["Advertising & marketing", true], ["Shipping & courier", true], ["Packaging", true], ["Software & tools", true],
    ["Rent & utilities", true], ["Salaries & contractors", true], ["Bank & transfer fees", true], ["Other operating expenses", true],
    ["Taxes & government fees", false], ["Interest & finance costs", false], ["Other non-operating expenses", false],
  ];
  for (const [name, isOperating] of cats) await db.expenseCategory.upsert({ where: { name }, create: { name, isOperating }, update: {} });
}

async function seedContent() {
  if ((await db.faqItem.count()) === 0) {
    await db.faqItem.createMany({ data: legacy.faqs.map((f, i) => ({ question: f.q, answer: f.a, sortOrder: i + 1 })) });
  }
  const pages = JSON.parse(readFileSync(path.join(import.meta.dirname, "seed-data/pages.json"), "utf8")) as { slug: string; title: string; body: string; showInFooter: boolean }[];
  for (const p of pages) await db.page.upsert({ where: { slug: p.slug }, create: p, update: {} });
}

async function main() {
  await seedSettings();
  const created = await seedCatalog();
  await seedPaymentMethods();
  await seedShippingZones();
  await seedExpenseCategories();
  await seedContent();
  const [products, variants, categories] = await Promise.all([db.product.count(), db.productVariant.count(), db.category.count()]);
  console.log(`Seed complete: ${products} products (${created} new), ${variants} plans/variants, ${categories} categories.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
