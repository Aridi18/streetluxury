"use client";

import { useActionState } from "react";
import { Check, ShoppingBag } from "lucide-react";
import { addToCartAction } from "@/app/actions/cart";
import { SubmitButton } from "../submit-button";

/** One-tap add for products with a single option. */
export function QuickAddButton({ variantId, label = "Add" }: { variantId: string; label?: string }) {
  const [state, action] = useActionState(addToCartAction, null);
  return (
    <form action={action} className="relative">
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="quantity" value="1" />
      <SubmitButton size="sm" variant={state?.ok ? "secondary" : "primary"} pendingLabel="Adding" aria-label={label}>
        {state?.ok ? <Check className="size-4" /> : <ShoppingBag className="size-4" />}
        {state?.ok ? "Added" : label}
      </SubmitButton>
      {state && !state.ok && <p className="absolute right-0 top-full mt-1 w-48 text-right text-xs text-danger">{state.error}</p>}
    </form>
  );
}
