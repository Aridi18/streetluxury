"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { ActionResult } from "@/lib/errors";
import { SubmitButton } from "./submit-button";
import { FormMessage } from "./form-message";
import { cn } from "./ui";


/**
 * Generic form bound to a server action: shows the server's error/success message, disables the submit
 * button while saving (no double submissions) and optionally resets or hides itself after success.
 */
export function ActionForm<T = undefined>({
  action,
  children,
  submitLabel = "Save",
  pendingLabel = "Saving…",
  className,
  submitVariant,
  submitClassName,
  hideOnSuccess,
  resetOnSuccess,
  successContent,
  encType,
}: {
  action: (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;
  children?: ReactNode;
  submitLabel?: ReactNode;
  pendingLabel?: string;
  className?: string;
  submitVariant?: "primary" | "secondary" | "danger" | "outline" | "ghost" | "whatsapp";
  submitClassName?: string;
  hideOnSuccess?: boolean;
  resetOnSuccess?: boolean;
  successContent?: ReactNode;
  encType?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  if (state?.ok && hideOnSuccess) {
    return (
      <div className="space-y-4">
        <FormMessage state={state} />
        {successContent}
      </div>
    );
  }
  return (
    <form ref={ref} action={formAction} className={cn("space-y-4", className)} encType={encType}>
      {children}
      <FormMessage state={state} />
      <SubmitButton variant={submitVariant} pendingLabel={pendingLabel} className={submitClassName}>
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
