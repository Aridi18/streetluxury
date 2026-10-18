import type { Metadata } from "next";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { ROLE_LABELS } from "@/lib/permissions";
import { acceptInvitationAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { Alert, Field, Input, LinkButton } from "@/components/ui";

export const metadata: Metadata = { title: "Admin invitation", robots: { index: false }, referrer: "no-referrer" };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await db.staffInvitation.findUnique({ where: { tokenHash: sha256(token) } });
  const valid = invite && !invite.acceptedAt && !invite.revokedAt && invite.expiresAt > new Date();
  return (
    <div className="card p-8">
      <h1 className="mb-1 text-2xl font-bold">Join the Digital District team</h1>
      {!valid ? (
        <Alert tone="warning" className="mt-4">This invitation is invalid, expired or already used. Ask the owner to send a new one.</Alert>
      ) : (
        <>
          <p className="mb-6 text-sm text-muted">{invite.email} · {ROLE_LABELS[invite.role]}</p>
          <ActionForm action={acceptInvitationAction} submitLabel="Create admin account" submitClassName="w-full" hideOnSuccess successContent={<LinkButton href="/login?next=/admin" className="w-full">Sign in</LinkButton>}>
            <input type="hidden" name="token" value={token} />
            <Field label="Your name" htmlFor="name"><Input id="name" name="name" required defaultValue={invite.name ?? ""} autoComplete="name" /></Field>
            <Field label="Password" htmlFor="password" hint="At least 10 characters, with letters and numbers. Use a unique password."><Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
            <Field label="Confirm password" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" required autoComplete="new-password" /></Field>
          </ActionForm>
        </>
      )}
    </div>
  );
}
