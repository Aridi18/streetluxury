"use client";

import { useActionState } from "react";
import { confirmTotpAction, startTotpAction } from "@/app/admin/_actions/setup";
import { ActionForm } from "../action-form";
import { Button, Field, Input } from "../ui";
import { FormMessage } from "../form-message";

export function TotpSetup() {
  const [state, start, pending] = useActionState(startTotpAction, null);
  if (!state?.ok || !state.data) {
    return (
      <form action={start} className="space-y-3">
        <p className="text-sm text-muted">Use an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.</p>
        <FormMessage state={state} />
        <Button disabled={pending}>{pending ? "Preparing…" : "Set up two-step verification"}</Button>
      </form>
    );
  }
  return (
    <div className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted"><li>Scan this QR code with your authenticator app.</li><li>Enter the 6-digit code it shows.</li></ol>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={state.data.qr} alt="QR code for your authenticator app" className="rounded-xl bg-white p-2" width={220} height={220} />
      <p className="text-xs text-subtle">Can&apos;t scan? Enter this key manually: <span className="select-all font-mono text-fg">{state.data.secret.match(/.{1,4}/g)?.join(" ")}</span></p>
      <ActionForm action={confirmTotpAction} submitLabel="Confirm and turn on">
        <Field label="Code from the app" htmlFor="totp-code"><Input id="totp-code" name="code" inputMode="numeric" autoComplete="one-time-code" required className="max-w-40 text-center font-mono tracking-[0.3em]" /></Field>
      </ActionForm>
    </div>
  );
}
