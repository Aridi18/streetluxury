export function fmtTime(t: number | null | undefined, precise = true): string {
  if (t == null || !Number.isFinite(t)) return "—";
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const ss = precise ? sec.toFixed(2).padStart(5, "0") : String(Math.floor(sec)).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtDuration(t: number | null | undefined): string {
  if (t == null || !Number.isFinite(t)) return "—";
  if (t < 60) return `${t.toFixed(1)} s`;
  const m = Math.floor(t / 60);
  const s = Math.round(t - m * 60);
  return `${m} min ${s} s`;
}

export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, withTime
    ? { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "numeric" });
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return fmtDate(iso, false);
}

export function fmtHz(hz: number | null | undefined): string {
  if (hz == null) return "—";
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`;
}

export function fmtPct(x: number | null | undefined, digits = 0): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${(x * 100).toFixed(digits)}%`;
}

export function shortHash(h: string | null | undefined, n = 12): string {
  return h ? `${h.slice(0, n)}…` : "—";
}
