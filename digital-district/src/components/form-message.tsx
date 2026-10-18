import type { ActionResult } from "@/lib/errors";
import { Alert } from "./ui";

export function FormMessage({ state }: { state: ActionResult<unknown> | null | undefined }) {
  if (!state) return null;
  if (state.ok) return state.message ? <Alert tone="success">{state.message}</Alert> : null;
  return <Alert tone="danger"><span className="whitespace-pre-line">{state.error}</span></Alert>;
}
