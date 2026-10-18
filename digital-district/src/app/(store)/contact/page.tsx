import type { Metadata } from "next";
import { Clock, Mail, MapPin, Phone } from "lucide-react";
import { getSettings } from "@/lib/settings";
import { waLink } from "@/lib/whatsapp";
import { contactAction } from "@/app/actions/public";
import { ActionForm } from "@/components/action-form";
import { WhatsAppIcon } from "@/components/store/icons";
import { Field, Input, Textarea, buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Contact us" };

export default async function ContactPage() {
  const s = await getSettings();
  return (
    <div className="container-page py-14">
      <p className="eyebrow mb-2">Contact</p>
      <h1 className="mb-2 text-3xl font-bold sm:text-4xl">We&apos;re here to help</h1>
      <p className="mb-10 max-w-xl text-muted">The fastest way to reach us is WhatsApp — we usually reply within minutes during support hours.</p>
      <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-3">
          <a href={waLink(s.whatsappNumber, s.whatsappDefaultMessage)} target="_blank" rel="noopener noreferrer" className={buttonClass("whatsapp", "lg", "w-full")}><WhatsAppIcon className="size-5" /> Chat on WhatsApp</a>
          <ul className="card divide-y divide-line text-sm">
            <li className="flex items-center gap-3 p-4"><Phone className="size-4 text-brand-300" /><a href={`tel:+${s.whatsappNumber}`}>{s.phoneDisplay}</a></li>
            {s.supportEmail && <li className="flex items-center gap-3 p-4"><Mail className="size-4 text-brand-300" /><a href={`mailto:${s.supportEmail}`} className="break-all">{s.supportEmail}</a></li>}
            {s.supportHours && <li className="flex items-center gap-3 p-4"><Clock className="size-4 text-brand-300" />{s.supportHours}</li>}
            {s.address && <li className="flex items-center gap-3 p-4"><MapPin className="size-4 text-brand-300" />{s.address}</li>}
          </ul>
        </div>
        <div className="card p-6">
          <h2 className="mb-4 text-lg font-semibold">Send us a message</h2>
          <ActionForm action={contactAction} submitLabel="Send message" pendingLabel="Sending…" hideOnSuccess>
            <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="name" required><Input id="name" name="name" required autoComplete="name" /></Field>
              <Field label="Phone / WhatsApp" htmlFor="phone"><Input id="phone" name="phone" type="tel" autoComplete="tel" /></Field>
            </div>
            <Field label="Email" htmlFor="email" hint="Leave a phone number or an email so we can reply"><Input id="email" name="email" type="email" autoComplete="email" /></Field>
            <Field label="Subject" htmlFor="subject" required><Input id="subject" name="subject" required maxLength={160} /></Field>
            <Field label="Message" htmlFor="message" required><Textarea id="message" name="message" required minLength={10} maxLength={4000} /></Field>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
