import { cache } from "react";
import { db } from "./db";

export type NavLink = { label: string; href: string };
export type Benefit = { title: string; text: string; icon: string };
export type HomeSectionKey =
  | "hero"
  | "categories"
  | "offers"
  | "featured"
  | "bestsellers"
  | "newArrivals"
  | "collections"
  | "recentlyViewed"
  | "reviews"
  | "howItWorks"
  | "benefits"
  | "newsletter";

export type StoreSettings = {
  storeName: string;
  tagline: string;
  logoKey: string | null;
  domain: string;
  currency: string;
  whatsappNumber: string; // E.164 digits, no "+"
  phoneDisplay: string;
  supportEmail: string;
  address: string;
  supportHours: string;
  instagramUrl: string;
  facebookUrl: string;
  tiktokUrl: string;
  announcement: string;
  announcementEnabled: boolean;
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  seoTitle: string;
  seoDescription: string;
  whatsappDefaultMessage: string;
  benefits: Benefit[];
  howItWorks: { title: string; text: string }[];
  homeSections: { key: HomeSectionKey; enabled: boolean }[];
  footerLinks: NavLink[];
  // Commerce policies
  guestCheckout: boolean;
  pickupEnabled: boolean;
  pickupAddress: string;
  pickupInstructions: string;
  taxEnabled: boolean;
  taxName: string;
  taxRateBps: number;
  taxInclusive: boolean;
  unconfirmedOrderExpiryHours: number; // 0 = never auto-cancel
  downloadExpiryDays: number;
  maxDownloads: number;
  renewalReminderDays: number;
  require2faForStaff: boolean;
  reviewsRequireApproval: boolean;
};

export const DEFAULT_SETTINGS: StoreSettings = {
  storeName: "Digital District",
  tagline: "DIGITAL SERVICES. LIMITLESS ACCESS.",
  logoKey: null,
  domain: "digitaldistrict.store",
  currency: "USD",
  whatsappNumber: "96181745567",
  phoneDisplay: "+961 81 745 567",
  supportEmail: "",
  address: "Beirut, Lebanon",
  supportHours: "Every day, 9:00 – 23:00",
  instagramUrl: "",
  facebookUrl: "",
  tiktokUrl: "",
  announcement: "",
  announcementEnabled: false,
  heroEyebrow: "Trusted digital services store",
  heroTitle: "Premium digital services, delivered fast.",
  heroSubtitle: "",
  seoTitle: "Digital District — Digital services, software and more",
  seoDescription: "",
  whatsappDefaultMessage: "Hello Digital District, I would like to ask about one of your products.",
  benefits: [],
  howItWorks: [],
  homeSections: [
    { key: "hero", enabled: true },
    { key: "categories", enabled: true },
    { key: "offers", enabled: true },
    { key: "bestsellers", enabled: true },
    { key: "featured", enabled: true },
    { key: "newArrivals", enabled: true },
    { key: "collections", enabled: true },
    { key: "recentlyViewed", enabled: true },
    { key: "reviews", enabled: true },
    { key: "howItWorks", enabled: true },
    { key: "benefits", enabled: true },
    { key: "newsletter", enabled: true },
  ],
  footerLinks: [],
  guestCheckout: true,
  pickupEnabled: false,
  pickupAddress: "",
  pickupInstructions: "",
  taxEnabled: false,
  taxName: "VAT",
  taxRateBps: 1100,
  taxInclusive: true,
  unconfirmedOrderExpiryHours: 72,
  downloadExpiryDays: 30,
  maxDownloads: 10,
  renewalReminderDays: 5,
  require2faForStaff: false,
  reviewsRequireApproval: true,
};

const SETTINGS_KEY = "store";

async function loadSettings(): Promise<StoreSettings> {
  const row = await db.setting.findUnique({ where: { key: SETTINGS_KEY } });
  const stored = (row?.value ?? {}) as Partial<StoreSettings>;
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  // Keep any home sections added in newer versions.
  const known = new Set(merged.homeSections.map((s) => s.key));
  for (const s of DEFAULT_SETTINGS.homeSections) if (!known.has(s.key)) merged.homeSections.push(s);
  return merged;
}

/** Store settings for this request (memoised per request). */
export const getSettings = cache(loadSettings);

/** Uncached read for services that run outside a request (jobs, tests). */
export const readSettings = loadSettings;

export async function updateSettings(patch: Partial<StoreSettings>): Promise<StoreSettings> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await db.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: next },
    update: { value: next },
  });
  return next;
}
