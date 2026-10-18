// Phone number handling for Lebanese and international numbers.

/**
 * Normalises a phone number to E.164 digits (no "+"), e.g. "81 745 567" -> "96181745567".
 * Lebanese local numbers (7–8 digits, optionally with a leading 0) get the 961 prefix.
 * Returns null when the number cannot be valid.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else {
    // Local Lebanese formats: 03 123 456, 3123456, 81745567, 01 234 567
    const local = digits.replace(/^0/, "");
    if (/^\d{7,8}$/.test(local)) digits = "961" + local;
  }
  if (digits.includes("+")) return null;
  if (!/^\d{8,15}$/.test(digits)) return null;
  if (digits.startsWith("961")) {
    const national = digits.slice(3).replace(/^0/, "");
    if (!/^\d{7,8}$/.test(national)) return null;
    return "961" + national;
  }
  return digits;
}

export function formatPhone(e164Digits: string | null | undefined): string {
  if (!e164Digits) return "";
  if (e164Digits.startsWith("961")) {
    const n = e164Digits.slice(3);
    if (n.length === 8) return `+961 ${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
    if (n.length === 7) return `+961 ${n.slice(0, 1)} ${n.slice(1, 4)} ${n.slice(4)}`;
  }
  return "+" + e164Digits;
}
