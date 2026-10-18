"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "../ui";

declare global {
  interface Window {
    Checkout?: { configure: (cfg: { session: { id: string } }) => void; showPaymentPage: () => void };
  }
}

/** Loads the bank's hosted checkout script and sends the customer to the bank's secure payment page. */
export function CardCheckout({ sessionId, scriptUrl, amountLabel, nonce }: { sessionId: string; scriptUrl: string; amountLabel: string; nonce?: string }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  function pay() {
    setState("loading");
    const go = () => {
      try {
        window.Checkout!.configure({ session: { id: sessionId } });
        window.Checkout!.showPaymentPage();
      } catch {
        setState("error");
      }
    };
    if (window.Checkout) return go();
    const s = document.createElement("script");
    s.src = scriptUrl;
    if (nonce) s.nonce = nonce;
    s.onload = go;
    s.onerror = () => setState("error");
    document.head.appendChild(s);
  }
  return (
    <div className="space-y-3">
      <Button size="lg" className="w-full" onClick={pay} disabled={state === "loading"}>
        <Lock className="size-4" /> {state === "loading" ? "Opening secure payment page…" : `Pay ${amountLabel} securely`}
      </Button>
      {state === "error" && <p className="text-sm text-danger">The payment page could not be opened. Please try again, or choose another payment method on WhatsApp.</p>}
    </div>
  );
}
