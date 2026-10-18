"use client";

import { useActionState } from "react";
import { customerCancelAction, submitPaymentAction } from "@/app/actions/order";
import { Field, Input, Textarea } from "../ui";
import { SubmitButton } from "../submit-button";
import { FormMessage } from "../form-message";

export function PaymentSubmitForm({ number, accessKey, requiresReference, allowProof }: { number: string; accessKey: string; requiresReference: boolean; allowProof: boolean }) {
  const [state, action] = useActionState(submitPaymentAction, null);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="number" value={number} />
      <input type="hidden" name="key" value={accessKey} />
      <Field label="Transaction reference" htmlFor="reference" required={requiresReference} hint="The reference or transaction ID you received after paying">
        <Input id="reference" name="reference" required={requiresReference} maxLength={120} autoComplete="off" />
      </Field>
      {allowProof && (
        <Field label="Payment proof (optional)" htmlFor="proof" hint="Screenshot or receipt — JPG, PNG, WebP or PDF, up to 8 MB">
          <Input id="proof" name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="h-auto py-2 file:mr-3 file:rounded-lg file:border-0 file:bg-surface-3 file:px-3 file:py-1.5 file:text-sm file:text-fg" />
        </Field>
      )}
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Sending…">Submit payment details</SubmitButton>
    </form>
  );
}

export function CancelOrderForm({ number, accessKey }: { number: string; accessKey: string }) {
  const [state, action] = useActionState(customerCancelAction, null);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <details className="group">
      <summary className="cursor-pointer text-sm text-muted hover:text-danger">Cancel this order</summary>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="number" value={number} />
        <input type="hidden" name="key" value={accessKey} />
        <Textarea name="reason" placeholder="Reason (optional)" maxLength={500} className="min-h-16" />
        <FormMessage state={state} />
        <SubmitButton variant="danger" size="sm" pendingLabel="Cancelling…">Yes, cancel my order</SubmitButton>
      </form>
    </details>
  );
}
