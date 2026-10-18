"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { randomToken } from "@/lib/crypto";
import { clientInfo, getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { toActionError, type ActionResult } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { notifyStaff } from "@/lib/notifications";
import { NEWSLETTER_CONSENT } from "@/lib/consent";


export async function subscribeNewsletterAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    if (formData.get("website")) return { ok: true, message: "Thanks for subscribing!" }; // honeypot
    const email = z.email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
    if (!email.success) return { ok: false, error: "Enter a valid email address." };
    if (formData.get("consent") !== "on") return { ok: false, error: "Please tick the box to confirm you want to receive emails." };
    const { ip } = await clientInfo();
    await rateLimit(`newsletter:${ip}`, 5, 3600);
    await db.newsletterSubscriber.upsert({
      where: { email: email.data },
      create: { email: email.data, consentText: NEWSLETTER_CONSENT, consentAt: new Date(), ip, unsubscribeToken: randomToken(24) },
      update: { consentText: NEWSLETTER_CONSENT, consentAt: new Date(), unsubscribedAt: null, ip },
    });
    return { ok: true, message: "Thanks for subscribing! You can unsubscribe at any time." };
  } catch (err) {
    return toActionError(err);
  }
}

const contactSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(120),
  email: z.union([z.literal(""), z.email("Enter a valid email address.")]),
  phone: z.string().trim().max(40),
  subject: z.string().trim().min(3, "Add a subject.").max(160),
  message: z.string().trim().min(10, "Tell us a bit more (at least 10 characters).").max(4000),
});

export async function contactAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    if (formData.get("website")) return { ok: true, message: "Thanks — we'll get back to you soon." };
    const parsed = contactSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const phone = parsed.data.phone ? normalizePhone(parsed.data.phone) : null;
    if (parsed.data.phone && !phone) return { ok: false, error: "Enter a valid phone number." };
    if (!phone && !parsed.data.email) return { ok: false, error: "Leave an email address or phone number so we can reply." };
    const { ip } = await clientInfo();
    await rateLimit(`contact:${ip}`, 5, 3600);
    const user = await getCurrentUser();
    const req = await db.supportRequest.create({
      data: { type: "CONTACT", userId: user?.id, name: parsed.data.name, email: parsed.data.email || null, phone, subject: parsed.data.subject, message: parsed.data.message },
    });
    await notifyStaff({ type: "support", title: `New message: ${parsed.data.subject}`, body: parsed.data.name, link: `/admin/support/${req.id}`, permission: "support.manage" });
    return { ok: true, message: "Thanks — your message has been sent. We usually reply within a few hours." };
  } catch (err) {
    return toActionError(err);
  }
}
