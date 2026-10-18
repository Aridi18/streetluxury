"use client";

import { useState } from "react";
import { Check, Link2, Share2 } from "lucide-react";
import { WhatsAppIcon, FacebookIcon } from "./icons";

export function ShareButtons({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;
  const btn = "grid size-10 place-items-center rounded-full border border-line-strong text-muted transition hover:border-brand-400 hover:text-white";
  return (
    <div className="flex items-center gap-2">
      <span className="mr-1 text-sm text-subtle">Share</span>
      {canShare && (
        <button type="button" className={btn} aria-label="Share" onClick={() => navigator.share({ title, url }).catch(() => undefined)}>
          <Share2 className="size-4" />
        </button>
      )}
      <a className={btn} href={`https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on WhatsApp">
        <WhatsAppIcon className="size-4" />
      </a>
      <a className={btn} href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on Facebook">
        <FacebookIcon className="size-4" />
      </a>
      <button
        type="button"
        className={btn}
        aria-label="Copy link"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // clipboard unavailable
          }
        }}
      >
        {copied ? <Check className="size-4 text-success" /> : <Link2 className="size-4" />}
      </button>
    </div>
  );
}
