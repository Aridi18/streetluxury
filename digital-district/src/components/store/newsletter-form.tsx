"use client";

import { useActionState } from "react";
import { subscribeNewsletterAction } from "@/app/actions/public";
import { Checkbox, Input } from "../ui";
import { SubmitButton } from "../submit-button";
import { FormMessage } from "../form-message";

export function NewsletterForm({ consentText }: { consentText: string }) {
  const [state, action] = useActionState(subscribeNewsletterAction, null);
  if (state?.ok) return <FormMessage state={state} />;
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="nl-email" className="sr-only">Email address</label>
        <Input id="nl-email" name="email" type="email" required placeholder="you@example.com" autoComplete="email" className="sm:flex-1" />
        <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        <SubmitButton pendingLabel="Subscribing">Subscribe</SubmitButton>
      </div>
      <Checkbox name="consent" required label={consentText} />
      <FormMessage state={state} />
    </form>
  );
}
