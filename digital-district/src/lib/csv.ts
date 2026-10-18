import Papa from "papaparse";

/** Neutralises spreadsheet formula injection (cells starting with = + - @ are prefixed with '). */
function safeCell(v: unknown): string | number | boolean | null {
  if (v == null) return "";
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]) : []);
  return Papa.unparse({ fields: cols, data: rows.map((r) => cols.map((c) => safeCell(r[c]))) });
}

export function csvResponse(csv: string, filename: string) {
  return new Response("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" },
  });
}

export function parseCsv(text: string): { rows: Record<string, string>[]; errors: string[] } {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
  return { rows: res.data, errors: res.errors.slice(0, 10).map((e) => `Row ${(e.row ?? 0) + 2}: ${e.message}`) };
}

export const cents = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2));
