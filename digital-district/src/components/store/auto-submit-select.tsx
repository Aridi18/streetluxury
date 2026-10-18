"use client";

import type { ComponentProps } from "react";
import { Select } from "../ui";

/** A select that submits its form as soon as the value changes (the form still works without JavaScript). */
export function AutoSubmitSelect(props: ComponentProps<typeof Select>) {
  return <Select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
