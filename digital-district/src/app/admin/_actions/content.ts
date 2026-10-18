"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { DEFAULT_SETTINGS, readSettings, updateSettings, type HomeSectionKey, type StoreSettings } from "@/lib/settings";
import { saveOriginalImage, saveProductImage } from "@/lib/storage";
import { normalizePhone } from "@/lib/phone";
import { zonedDateTime } from "@/lib/time";
import { slugify } from "@/lib/products-admin";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const url = (v: string) => (!v || /^https:\/\//.test(v) ? v : null);
const done = (message: string): ActionResult => {
  revalidatePath("/", "layout");
  return { ok: true, message };
};

/** Store settings are split into sections; each form only updates the fields it contains. */
export async function saveSettingsAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const section = s(f, "section");
    const user = await requireStaff(section === "homepage" || section === "seo" ? "content.manage" : "settings.manage");
    const patch: Partial<StoreSettings> = {};
    if (section === "store") {
      const wa = normalizePhone(s(f, "whatsappNumber"));
      if (!wa) return { ok: false, error: "Enter a valid WhatsApp number." };
      for (const k of ["instagramUrl", "facebookUrl", "tiktokUrl"] as const) {
        if (url(s(f, k)) === null) return { ok: false, error: "Social links must start with https://" };
        patch[k] = s(f, k);
      }
      Object.assign(patch, {
        storeName: s(f, "storeName") || DEFAULT_SETTINGS.storeName,
        tagline: s(f, "tagline"),
        domain: s(f, "domain"),
        whatsappNumber: wa,
        phoneDisplay: s(f, "phoneDisplay"),
        supportEmail: s(f, "supportEmail"),
        address: s(f, "address"),
        supportHours: s(f, "supportHours"),
        whatsappDefaultMessage: s(f, "whatsappDefaultMessage"),
        announcement: s(f, "announcement"),
        announcementEnabled: f.get("announcementEnabled") === "on",
      });
      const logo = f.get("logo");
      if (logo instanceof File && logo.size > 0) patch.logoKey = await saveOriginalImage(logo);
      if (f.get("removeLogo") === "on") patch.logoKey = null;
    } else if (section === "homepage") {
      const current = await readSettings();
      const keys = current.homeSections.map((x) => x.key);
      patch.homeSections = keys
        .map((key) => ({ key: key as HomeSectionKey, enabled: f.get(`sec_${key}`) === "on", order: Number(s(f, `ord_${key}`)) || 0 }))
        .sort((a, b) => a.order - b.order)
        .map(({ key, enabled }) => ({ key, enabled }));
      patch.heroEyebrow = s(f, "heroEyebrow");
      patch.heroTitle = s(f, "heroTitle") || DEFAULT_SETTINGS.heroTitle;
      patch.heroSubtitle = s(f, "heroSubtitle");
      patch.benefits = [0, 1, 2, 3].map((i) => ({ icon: s(f, `b_icon_${i}`) || "badge", title: s(f, `b_title_${i}`), text: s(f, `b_text_${i}`) })).filter((b) => b.title);
      patch.howItWorks = [0, 1, 2, 3].map((i) => ({ title: s(f, `h_title_${i}`), text: s(f, `h_text_${i}`) })).filter((h) => h.title);
      patch.footerLinks = s(f, "footerLinks").split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0] && p[1] && (p[1].startsWith("/") || p[1].startsWith("https://"))).map(([label, href]) => ({ label, href }));
    } else if (section === "seo") {
      patch.seoTitle = s(f, "seoTitle");
      patch.seoDescription = s(f, "seoDescription");
    } else if (section === "commerce") {
      const n = (k: string, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(Number(s(f, k)) || 0)));
      Object.assign(patch, {
        currency: "USD",
        guestCheckout: f.get("guestCheckout") === "on",
        pickupEnabled: f.get("pickupEnabled") === "on",
        pickupAddress: s(f, "pickupAddress"),
        pickupInstructions: s(f, "pickupInstructions"),
        taxEnabled: f.get("taxEnabled") === "on",
        taxName: s(f, "taxName") || "VAT",
        taxRateBps: Math.round(Number(s(f, "taxRate") || 0) * 100),
        taxInclusive: s(f, "taxMode") !== "exclusive",
        unconfirmedOrderExpiryHours: n("unconfirmedOrderExpiryHours", 0, 24 * 30),
        downloadExpiryDays: n("downloadExpiryDays", 0, 3650),
        maxDownloads: n("maxDownloads", 0, 1000),
        renewalReminderDays: n("renewalReminderDays", 0, 60),
        require2faForStaff: f.get("require2faForStaff") === "on",
        reviewsRequireApproval: f.get("reviewsRequireApproval") === "on",
      });
      if (patch.pickupEnabled && !patch.pickupAddress) return { ok: false, error: "Add the pickup address before enabling pickup." };
      if (patch.taxEnabled && !(patch.taxRateBps! > 0 && patch.taxRateBps! < 10000)) return { ok: false, error: "Enter a tax rate between 0 and 100%." };
    } else return { ok: false, error: "Unknown settings section." };
    await updateSettings(patch);
    await audit(user, "settings.update", "Setting", section, `Updated ${section} settings`, JSON.parse(JSON.stringify({ ...patch, logoKey: undefined })));
    return done("Settings saved.");
  } catch (err) {
    return toActionError(err);
  }
}

export async function saveBannerAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("content.manage");
    const id = s(f, "id") || undefined;
    if (!s(f, "title")) return { ok: false, error: "Enter a headline." };
    const href = s(f, "ctaHref");
    if (href && !href.startsWith("/") && !href.startsWith("https://")) return { ok: false, error: "The button link must start with / or https://" };
    const image = f.get("image");
    const imageKey = image instanceof File && image.size > 0 ? (await saveProductImage(image, "banners")).key : undefined;
    const data = {
      title: s(f, "title"), subtitle: s(f, "subtitle") || null, eyebrow: s(f, "eyebrow") || null, ctaLabel: s(f, "ctaLabel") || null, ctaHref: href || null,
      startsAt: s(f, "startsAt") ? zonedDateTime(s(f, "startsAt")) : null, endsAt: s(f, "endsAt") ? zonedDateTime(s(f, "endsAt")) : null,
      isActive: f.get("isActive") === "on", sortOrder: Number(s(f, "sortOrder")) || 0, ...(imageKey ? { imageKey } : {}),
    };
    const b = id ? await db.banner.update({ where: { id }, data }) : await db.banner.create({ data });
    await audit(user, "banner.save", "Banner", b.id, `Saved banner “${b.title}”`);
    revalidatePath("/admin/content");
    return done("Banner saved.");
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteBannerAction(f: FormData) {
  const user = await requireStaff("content.manage");
  const b = await db.banner.delete({ where: { id: s(f, "id") } });
  await audit(user, "banner.delete", "Banner", b.id, `Deleted banner “${b.title}”`);
  revalidatePath("/admin/content");
  revalidatePath("/", "layout");
}

export async function savePageAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("content.manage");
    const id = s(f, "id") || undefined;
    const slug = slugify(s(f, "slug") || s(f, "title"));
    if (!s(f, "title") || !slug) return { ok: false, error: "Enter a title." };
    const reserved = ["shop", "product", "category", "brand", "collection", "offers", "cart", "checkout", "order", "track", "account", "admin", "login", "register", "faq", "contact", "api", "media", "invite"];
    if (reserved.includes(slug)) return { ok: false, error: "That web address is reserved by the store. Choose another." };
    const clash = await db.page.findUnique({ where: { slug } });
    if (clash && clash.id !== id) return { ok: false, error: "Another page already uses that web address." };
    const data = { slug, title: s(f, "title"), body: String(f.get("body") ?? ""), isPublished: f.get("isPublished") === "on", showInFooter: f.get("showInFooter") === "on", seoTitle: s(f, "seoTitle") || null, seoDescription: s(f, "seoDescription") || null };
    const page = id ? await db.page.update({ where: { id }, data }) : await db.page.create({ data });
    await audit(user, "page.save", "Page", page.id, `Saved page “${page.title}”`);
    revalidatePath("/admin/pages");
    return done("Page saved.");
  } catch (err) {
    return toActionError(err);
  }
}

export async function saveFaqAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("content.manage");
    const id = s(f, "id") || undefined;
    if (f.get("delete") === "on" && id) {
      await db.faqItem.delete({ where: { id } });
      await audit(user, "faq.delete", "FaqItem", id, "Deleted FAQ");
      revalidatePath("/admin/pages");
      return done("Question deleted.");
    }
    if (!s(f, "question") || !s(f, "answer")) return { ok: false, error: "Enter a question and an answer." };
    const data = { question: s(f, "question"), answer: s(f, "answer"), sortOrder: Number(s(f, "sortOrder")) || 0, isVisible: f.get("isVisible") === "on" };
    const faq = id ? await db.faqItem.update({ where: { id }, data }) : await db.faqItem.create({ data });
    await audit(user, "faq.save", "FaqItem", faq.id, `Saved FAQ “${faq.question}”`);
    revalidatePath("/admin/pages");
    return done("Question saved.");
  } catch (err) {
    return toActionError(err);
  }
}
