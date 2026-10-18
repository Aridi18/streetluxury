"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { WhatsAppIcon } from "./icons";
import { buttonClass } from "../ui";

/**
 * Hands a prepared order message to WhatsApp. We can't know whether the customer actually sends it,
 * so the order stays "Pending confirmation" until staff confirm it.
 */
export function WhatsAppPanel({ message, appLink, webLink, autoOpen, orderNumber }: { message: string; appLink: string; webLink: string; autoOpen: boolean; orderNumber: string }) {
  const [copied, setCopied] = useState(false);
  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || opened.current) return;
    opened.current = true;
    const key = `dd_wa_opened_${orderNumber}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // storage unavailable: still try once
    }
    const t = setTimeout(() => window.open(appLink, "_blank", "noopener"), 600);
    return () => clearTimeout(t);
  }, [autoOpen, appLink, orderNumber]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <a href={appLink} target="_blank" rel="noopener noreferrer" className={buttonClass("whatsapp", "lg")}>
          <WhatsAppIcon className="size-5" /> Open WhatsApp
        </a>
        <button type="button" onClick={copy} className={buttonClass("secondary", "lg")}>
          {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />} {copied ? "Message copied" : "Copy message"}
        </button>
      </div>
      <p className="text-xs text-subtle">
        WhatsApp didn&apos;t open?{" "}
        <a href={webLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-300 underline">
          Try WhatsApp Web <ExternalLink className="size-3" />
        </a>{" "}
        or copy the message and send it to us.
      </p>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-ink p-4 font-sans text-sm text-fg/90">{message}</pre>
    </div>
  );
}
