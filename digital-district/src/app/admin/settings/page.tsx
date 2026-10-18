import type { Metadata } from "next";
import { requireStaffPage } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { publicFileUrl } from "@/lib/media";
import { emailConfigured } from "@/lib/email";
import { mpgsConfigured } from "@/lib/payments";
import { saveSettingsAction } from "@/app/admin/_actions/content";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Alert, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Store settings" };

export default async function SettingsPage() {
  await requireStaffPage("settings.manage");
  const s = await getSettings();
  const logo = publicFileUrl(s.logoKey);
  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Store settings" description="Changes appear on the website immediately." />
      <div className="grid gap-3 md:grid-cols-2">
        <Alert tone={emailConfigured() ? "success" : "warning"} title={emailConfigured() ? "Email sending is set up" : "Email sending is not set up"}>{emailConfigured() ? "Order confirmations and updates are emailed to customers." : "Set SMTP_URL on the server to send order emails. Everything else works; see the Email log for messages not sent."}</Alert>
        <Alert tone={mpgsConfigured() ? "success" : "info"} title={mpgsConfigured() ? "Card payment gateway connected" : "Card payments not connected"}>{mpgsConfigured() ? "Enable “Credit or debit card” in Payment methods to offer it." : "Online card payment needs a merchant account with a Lebanese acquirer (for example areeba). See the deployment guide."}</Alert>
      </div>
      <Panel title="Store details & brand">
        <ActionForm action={saveSettingsAction} submitLabel="Save store details">
          <input type="hidden" name="section" value="store" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2 flex flex-wrap items-center gap-4 rounded-xl border border-line bg-surface-2 p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {logo ? <img src={logo} alt="Current logo" className="h-16 w-auto" /> : <span className="text-sm text-muted">No logo uploaded — a text wordmark is shown.</span>}
              <div className="flex-1 space-y-2">
                <Field label="Upload your original logo" htmlFor="logo" hint="PNG (transparent background recommended), JPG or WebP. It is stored and shown exactly as uploaded — never recoloured or cropped."><Input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" className="h-auto py-2 text-sm" /></Field>
                {logo && <Checkbox name="removeLogo" label="Remove the current logo" />}
              </div>
            </div>
            <Field label="Store name" htmlFor="storeName"><Input id="storeName" name="storeName" defaultValue={s.storeName} /></Field>
            <Field label="Tagline" htmlFor="tagline"><Input id="tagline" name="tagline" defaultValue={s.tagline} /></Field>
            <Field label="WhatsApp number" htmlFor="whatsappNumber" hint="Orders via WhatsApp go to this number"><Input id="whatsappNumber" name="whatsappNumber" defaultValue={`+${s.whatsappNumber}`} required /></Field>
            <Field label="Phone as displayed" htmlFor="phoneDisplay"><Input id="phoneDisplay" name="phoneDisplay" defaultValue={s.phoneDisplay} /></Field>
            <Field label="Support email" htmlFor="supportEmail"><Input id="supportEmail" name="supportEmail" type="email" defaultValue={s.supportEmail} /></Field>
            <Field label="Domain" htmlFor="domain"><Input id="domain" name="domain" defaultValue={s.domain} /></Field>
            <Field label="Address / location" htmlFor="address"><Input id="address" name="address" defaultValue={s.address} /></Field>
            <Field label="Support hours" htmlFor="supportHours"><Input id="supportHours" name="supportHours" defaultValue={s.supportHours} /></Field>
            <Field label="Instagram link" htmlFor="instagramUrl"><Input id="instagramUrl" name="instagramUrl" defaultValue={s.instagramUrl} placeholder="https://instagram.com/…" /></Field>
            <Field label="Facebook link" htmlFor="facebookUrl"><Input id="facebookUrl" name="facebookUrl" defaultValue={s.facebookUrl} placeholder="https://facebook.com/…" /></Field>
            <Field label="TikTok link" htmlFor="tiktokUrl"><Input id="tiktokUrl" name="tiktokUrl" defaultValue={s.tiktokUrl} placeholder="https://tiktok.com/@…" /></Field>
            <Field label="Default WhatsApp message" htmlFor="whatsappDefaultMessage"><Input id="whatsappDefaultMessage" name="whatsappDefaultMessage" defaultValue={s.whatsappDefaultMessage} /></Field>
            <Field label="Announcement bar" htmlFor="announcement" className="md:col-span-2"><Input id="announcement" name="announcement" defaultValue={s.announcement} /></Field>
            <Checkbox name="announcementEnabled" defaultChecked={s.announcementEnabled} label="Show the announcement bar" />
          </div>
        </ActionForm>
      </Panel>
      <Panel title="Search engines (SEO)">
        <ActionForm action={saveSettingsAction} submitLabel="Save SEO">
          <input type="hidden" name="section" value="seo" />
          <Field label="Homepage title" htmlFor="seoTitle"><Input id="seoTitle" name="seoTitle" defaultValue={s.seoTitle} maxLength={70} /></Field>
          <Field label="Homepage description" htmlFor="seoDescription"><Textarea id="seoDescription" name="seoDescription" defaultValue={s.seoDescription} maxLength={170} className="min-h-16" /></Field>
        </ActionForm>
      </Panel>
      <Panel title="Checkout, tax & policies">
        <ActionForm action={saveSettingsAction} submitLabel="Save checkout settings">
          <input type="hidden" name="section" value="commerce" />
          <div className="grid gap-4 md:grid-cols-2">
            <Checkbox name="guestCheckout" defaultChecked={s.guestCheckout} label="Allow guest checkout (no account needed)" className="md:col-span-2" />
            <Checkbox name="pickupEnabled" defaultChecked={s.pickupEnabled} label="Offer free local pickup for physical products" className="md:col-span-2" />
            <Field label="Pickup address" htmlFor="pickupAddress"><Input id="pickupAddress" name="pickupAddress" defaultValue={s.pickupAddress} /></Field>
            <Field label="Pickup instructions" htmlFor="pickupInstructions"><Input id="pickupInstructions" name="pickupInstructions" defaultValue={s.pickupInstructions} /></Field>
            <Checkbox name="taxEnabled" defaultChecked={s.taxEnabled} label="Charge tax (e.g. VAT) — only if your business is registered" className="md:col-span-2" />
            <Field label="Tax name" htmlFor="taxName"><Input id="taxName" name="taxName" defaultValue={s.taxName} /></Field>
            <Field label="Tax rate (%)" htmlFor="taxRate"><Input id="taxRate" name="taxRate" inputMode="decimal" defaultValue={String(s.taxRateBps / 100)} /></Field>
            <Field label="Prices" htmlFor="taxMode"><Select id="taxMode" name="taxMode" defaultValue={s.taxInclusive ? "inclusive" : "exclusive"}><option value="inclusive">Already include tax</option><option value="exclusive">Tax is added at checkout</option></Select></Field>
            <Field label="Auto-cancel unconfirmed orders after (hours)" htmlFor="unconfirmedOrderExpiryHours" hint="Returns reserved stock. 0 = never."><Input id="unconfirmedOrderExpiryHours" name="unconfirmedOrderExpiryHours" inputMode="numeric" defaultValue={s.unconfirmedOrderExpiryHours} /></Field>
            <Field label="Download links valid for (days)" htmlFor="downloadExpiryDays" hint="0 = no expiry"><Input id="downloadExpiryDays" name="downloadExpiryDays" inputMode="numeric" defaultValue={s.downloadExpiryDays} /></Field>
            <Field label="Downloads allowed per item" htmlFor="maxDownloads" hint="0 = unlimited"><Input id="maxDownloads" name="maxDownloads" inputMode="numeric" defaultValue={s.maxDownloads} /></Field>
            <Field label="Renewal reminder (days before expiry)" htmlFor="renewalReminderDays" hint="0 = off"><Input id="renewalReminderDays" name="renewalReminderDays" inputMode="numeric" defaultValue={s.renewalReminderDays} /></Field>
            <Checkbox name="reviewsRequireApproval" defaultChecked={s.reviewsRequireApproval} label="Reviews need approval before they appear" className="md:col-span-2" />
            <Checkbox name="require2faForStaff" defaultChecked={s.require2faForStaff} label="Require two-step verification for all staff (recommended)" className="md:col-span-2" />
          </div>
        </ActionForm>
      </Panel>
    </div>
  );
}
