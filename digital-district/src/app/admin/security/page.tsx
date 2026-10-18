import type { Metadata } from "next";
import { requireStaffPage } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { disableTotpAction, staffPasswordAction } from "@/app/admin/_actions/setup";
import { ActionForm } from "@/components/action-form";
import { TotpSetup } from "@/components/admin/totp-setup";
import { PageHeader, Panel, fmtDateTime } from "@/components/admin/ui";
import { Alert, Field, Input } from "@/components/ui";

export const metadata: Metadata = { title: "My security" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ required?: string }> }) {
  const user = await requireStaffPage("dashboard.view");
  const s = await getSettings();
  const { required } = await searchParams;
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="My security" description="Protect your admin account." />
      {required && <Alert tone="warning">Two-step verification is required before you can use the admin panel.</Alert>}
      <Panel title="Two-step verification">
        {user.totpEnabledAt ? (
          <div className="space-y-4">
            <Alert tone="success">On since {fmtDateTime(user.totpEnabledAt)}. You&apos;ll enter a code from your app at every sign-in.</Alert>
            {!s.require2faForStaff && (
              <details>
                <summary className="cursor-pointer text-sm text-muted">Turn off</summary>
                <ActionForm action={disableTotpAction} submitLabel="Turn off two-step verification" submitVariant="danger" className="mt-3">
                  <Field label="Your password" htmlFor="pw"><Input id="pw" name="password" type="password" required /></Field>
                </ActionForm>
              </details>
            )}
          </div>
        ) : (
          <TotpSetup />
        )}
      </Panel>
      <Panel title="Change password">
        <ActionForm action={staffPasswordAction} submitLabel="Change password" resetOnSuccess>
          <Field label="Current password" htmlFor="cur"><Input id="cur" name="current" type="password" required autoComplete="current-password" /></Field>
          <Field label="New password" htmlFor="np" hint="At least 10 characters, with letters and numbers"><Input id="np" name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
          <Field label="Confirm" htmlFor="cp"><Input id="cp" name="confirm" type="password" required autoComplete="new-password" /></Field>
        </ActionForm>
      </Panel>
    </div>
  );
}
