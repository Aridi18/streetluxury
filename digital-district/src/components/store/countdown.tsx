"use client";

import { useEffect, useState } from "react";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** Live countdown to a promotion's real end date. Renders nothing once it has ended. */
export function Countdown({ endsAt, className }: { endsAt: string; className?: string }) {
  const end = new Date(endsAt).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  if (now === null) return <span className={className}>Ends {new Date(endsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>;
  if (now >= end) return null;
  const p = parts(end - now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className={className} aria-label={`Ends in ${p.d} days ${p.h} hours ${p.m} minutes`}>
      Ends in {p.d > 0 && `${p.d}d `}{pad(p.h)}:{pad(p.m)}:{pad(p.s)}
    </span>
  );
}
