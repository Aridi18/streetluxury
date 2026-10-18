import type { Metadata } from "next";
import Link from "next/link";
import { registerAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Checkbox, Field, Input } from "@/components/ui";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="card p-8">
      <h1 className="mb-1 text-2xl font-bold">Create your account</h1>
      <p className="mb-6 text-sm text-muted">Track orders, re-order in one tap and keep your digital deliveries in one place.</p>
      <ActionForm action={registerAction} submitLabel="Create account" pendingLabel="Creating…" submitClassName="w-full">
        <input type="hidden" name="next" value={next ?? ""} />
        <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        <Field label="Full name" htmlFor="name" required><Input id="name" name="name" required autoComplete="name" /></Field>
        <Field label="Email" htmlFor="email" required><Input id="email" name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Phone / WhatsApp" htmlFor="phone" hint="Optional — speeds up checkout"><Input id="phone" name="phone" type="tel" autoComplete="tel" /></Field>
        <Field label="Password" htmlFor="password" required hint="At least 10 characters, with letters and numbers"><Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
        <Field label="Confirm password" htmlFor="confirm" required><Input id="confirm" name="confirm" type="password" required autoComplete="new-password" /></Field>
        <Checkbox name="marketing" label="Send me occasional offers by email (optional — you can unsubscribe any time)" />
        <p className="text-xs text-subtle">By creating an account you agree to our <Link href="/terms" className="underline">terms</Link> and <Link href="/privacy" className="underline">privacy policy</Link>.</p>
      </ActionForm>
      <p className="mt-6 text-center text-sm text-muted">Already have an account? <Link href="/login" className="font-semibold text-brand-300">Sign in</Link></p>
    </div>
  );
}
