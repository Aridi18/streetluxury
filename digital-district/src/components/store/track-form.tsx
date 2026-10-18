"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { lookupOrderAction } from "@/app/actions/order";
import { Field, Input } from "../ui";
import { SubmitButton } from "../submit-button";
import { FormMessage } from "../form-message";

export function TrackForm() {
  const [state, action] = useActionState(lookupOrderAction, null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok && state.data) router.push(state.data.url);
  }, [state, router]);
  return (
    <form action={action} className="space-y-4">
      <Field label="Order number" htmlFor="number" required>
        <Input id="number" name="number" required placeholder="DD-100123" autoCapitalize="characters" />
      </Field>
      <Field label="Phone number or email used for the order" htmlFor="contact" required>
        <Input id="contact" name="contact" required placeholder="81 745 567 or you@example.com" />
      </Field>
      {state && !state.ok && <FormMessage state={state} />}
      <SubmitButton className="w-full" pendingLabel="Looking up…">Find my order</SubmitButton>
    </form>
  );
}
