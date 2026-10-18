import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { twoFactorAction } from "@/app/actions/auth";
import { getSession } from "@/lib/auth";
import { ActionForm } from "@/components/action-form";
import { Field, Input } from "@/components/ui";

export const metadata: Metadata = { title: "Two-step verification", robots: { index: false } };

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.totpPending) redirect(next ?? "/admin");
  return (
    <div className="card p-8">
      <h1 className="mb-1 text-2xl font-bold">Two-step verification</h1>
      <p className="mb-6 text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
      <ActionForm action={twoFactorAction} submitLabel="Verify" pendingLabel="Checking…" submitClassName="w-full">
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="Code" htmlFor="code"><Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus className="text-center font-mono text-lg tracking-[0.4em]" /></Field>
      </ActionForm>
    </div>
  );
}
