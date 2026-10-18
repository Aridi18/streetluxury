import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { supportRequestAction } from "@/app/actions/account";
import { ActionForm } from "@/components/action-form";
import { Field, Textarea, buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Privacy" };

export default async function PrivacyPage() {
  await requireUser("/account/privacy");
  return (
    <div className="space-y-6">
      <section className="card p-6">
        <h2 className="mb-2 text-xl font-semibold">Download your data</h2>
        <p className="mb-4 text-sm text-muted">Get a copy of the personal information we hold about you — profile, addresses, orders, reviews and support requests — as a JSON file.</p>
        <a href="/api/account/export" className={buttonClass("secondary", "md")}>Download my data</a>
      </section>
      <section className="card p-6">
        <h2 className="mb-2 text-xl font-semibold">Delete your account</h2>
        <p className="mb-4 text-sm text-muted">
          We will delete your account, addresses, wishlist and sign-in details and remove your name and contact details from past orders. Records of past sales are kept without your personal details, as required for accounting. Read our <Link href="/privacy" className="text-brand-300 underline">privacy policy</Link>.
        </p>
        <ActionForm action={supportRequestAction} submitLabel="Request account deletion" submitVariant="danger" hideOnSuccess>
          <input type="hidden" name="type" value="PRIVACY_DELETION" />
          <input type="hidden" name="subject" value="Account deletion request" />
          <Field label="Anything we should know? (optional)" htmlFor="message"><Textarea id="message" name="message" defaultValue="Please delete my account and personal data." /></Field>
        </ActionForm>
      </section>
    </div>
  );
}
