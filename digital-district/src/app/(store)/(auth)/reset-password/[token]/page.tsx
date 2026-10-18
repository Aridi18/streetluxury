import type { Metadata } from "next";
import Link from "next/link";
import { resetPasswordAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Field, Input, LinkButton } from "@/components/ui";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false }, referrer: "no-referrer" };

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="card p-8">
      <h1 className="mb-6 text-2xl font-bold">Choose a new password</h1>
      <ActionForm action={resetPasswordAction} submitLabel="Change password" submitClassName="w-full" hideOnSuccess successContent={<LinkButton href="/login" className="w-full">Sign in</LinkButton>}>
        <input type="hidden" name="token" value={token} />
        <Field label="New password" htmlFor="password" hint="At least 10 characters, with letters and numbers"><Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
        <Field label="Confirm new password" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" required autoComplete="new-password" /></Field>
      </ActionForm>
      <p className="mt-4 text-center text-sm"><Link href="/forgot-password" className="text-brand-300">Request a new link</Link></p>
    </div>
  );
}
