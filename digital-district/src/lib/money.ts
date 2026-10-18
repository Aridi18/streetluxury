// All amounts are integer cents. These helpers are the only place cents are converted.

export function formatMoney(cents: number, currency = "USD"): string {
  const value = cents / 100;
  const hasFraction = cents % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Parses "12", "12.5", "$12.50" into cents. Returns null for invalid input. */
export function parseMoney(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? Math.round(input * 100) : null;
  if (typeof input !== "string") return null;
  const cleaned = input.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

/** Percentage of `amount` given basis points (1% = 100 bps), rounded half up. */
export function percentOf(amount: number, bps: number): number {
  return Math.round((amount * bps) / 10000);
}
