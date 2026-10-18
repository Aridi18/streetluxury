import type { Metadata } from "next";
import Link from "next/link";
import { forgotPasswordAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Field, Input } from "@/components/ui";

export const metadata: Metadata = { title: "Reset your password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <div className="card p-8">
      <h1 className="mb-1 text-2xl font-bold">Forgot your password?</h1>
      <p className="mb-6 text-sm text-muted">Enter your email and we&apos;ll send you a link to choose a new one.</p>
      <ActionForm action={forgotPasswordAction} submitLabel="Send reset link" pendingLabel="Sending…" submitClassName="w-full" hideOnSuccess successContent={<Link href="/login" className="text-sm text-brand-300">Back to sign in</Link>}>
        <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" required autoComplete="email" autoFocus /></Field>
      </ActionForm>
    </div>
  );
}
