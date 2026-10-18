import nodemailer, { type Transporter } from "nodemailer";
import { db } from "./db";
import { env } from "./env";

let transporter: Transporter | null = null;

function getTransport(): Transporter | null {
  if (!env.smtpUrl) return null;
  transporter ??= nodemailer.createTransport(env.smtpUrl);
  return transporter;
}

export function emailConfigured() {
  return Boolean(env.smtpUrl);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Wraps plain paragraphs (and optional button) into a simple branded HTML email. */
export function renderEmail(opts: { heading: string; paragraphs: string[]; button?: { label: string; url: string }; footer?: string }) {
  const body = opts.paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.6">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`).join("");
  const button = opts.button
    ? `<p style="margin:24px 0"><a href="${escapeHtml(opts.button.url)}" style="background:#7c3aed;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">${escapeHtml(opts.button.label)}</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#0b0b0f;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#e7e5ee">
<div style="max-width:560px;margin:0 auto;background:#15151c;border:1px solid #2a2836;border-radius:16px;padding:32px">
<div style="font-weight:800;letter-spacing:.12em;color:#c4b5fd;font-size:13px;margin-bottom:18px">DIGITAL DISTRICT</div>
<h1 style="font-size:22px;margin:0 0 18px;color:#fff">${escapeHtml(opts.heading)}</h1>${body}${button}
<p style="margin:28px 0 0;font-size:12px;color:#8b8799">${escapeHtml(opts.footer ?? "Digital District · digitaldistrict.store")}</p>
</div></body></html>`;
  const text = [opts.heading, "", ...opts.paragraphs, opts.button ? `${opts.button.label}: ${opts.button.url}` : ""].join("\n");
  return { html, text };
}

/**
 * Sends an email when SMTP is configured. Never throws: delivery problems are recorded in EmailLog
 * so they are visible to the owner, and the business flow (e.g. placing an order) is not interrupted.
 */
export async function sendEmail(to: string | null | undefined, subject: string, template: string, content: { html: string; text: string }) {
  if (!to) return;
  const transport = getTransport();
  if (!transport) {
    await db.emailLog.create({ data: { to, subject, template, status: "NOT_CONFIGURED" } });
    return;
  }
  try {
    await transport.sendMail({ from: env.emailFrom, to, subject, html: content.html, text: content.text });
    await db.emailLog.create({ data: { to, subject, template, status: "SENT" } });
  } catch (err) {
    await db.emailLog.create({ data: { to, subject, template, status: "FAILED", error: String(err).slice(0, 500) } });
  }
}
