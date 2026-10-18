"use client";

import { useActionState } from "react";
import { applyCouponAction } from "@/app/actions/cart";
import { Input } from "../ui";
import { SubmitButton } from "../submit-button";

export function CouponForm() {
  const [state, action] = useActionState(applyCouponAction, null);
  return (
    <form action={action} className="space-y-1.5">
      <label htmlFor="coupon" className="text-sm font-medium text-fg/90">Discount code</label>
      <div className="flex gap-2">
        <Input id="coupon" name="code" placeholder="Enter code" autoCapitalize="characters" className="h-10 uppercase" maxLength={40} />
        <SubmitButton size="sm" variant="secondary" className="h-10" pendingLabel="…">Apply</SubmitButton>
      </div>
      {state && !state.ok && <p className="text-xs text-danger">{state.error}</p>}
    </form>
  );
}
