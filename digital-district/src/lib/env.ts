import { createHash } from "node:crypto";

// Central, validated access to environment configuration.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const env = {
  get appUrl() {
    // RENDER_EXTERNAL_URL is set automatically on Render, so the free demo needs no configuration.
    return (process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000").replace(/\/$/, "");
  },
  get storageDir() {
    return process.env.STORAGE_DIR || "./storage";
  },
  get encryptionKey(): Buffer {
    const raw = required("DATA_ENCRYPTION_KEY");
    const key = Buffer.from(raw, "base64");
    if (key.length === 32) return key;
    // Hosting platforms may generate secrets in other formats: accept any long random secret and derive a 32-byte key.
    if (raw.length < 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes base64-encoded (openssl rand -base64 32) or a random secret of at least 32 characters");
    return createHash("sha256").update(raw).digest();
  },
  get cronSecret() {
    return process.env.CRON_SECRET || "";
  },
  get smtpUrl() {
    return process.env.SMTP_URL || "";
  },
  get emailFrom() {
    return process.env.EMAIL_FROM || "Digital District <no-reply@digitaldistrict.store>";
  },
  get ownerAlertEmail() {
    return process.env.OWNER_ALERT_EMAIL || "";
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  /** Cookies are marked Secure whenever the store is served over HTTPS (always the case in real deployments). */
  get secureCookies() {
    return this.appUrl.startsWith("https://");
  },
  mpgs: {
    get gatewayUrl() {
      return (process.env.MPGS_GATEWAY_URL || "").replace(/\/$/, "");
    },
    get merchantId() {
      return process.env.MPGS_MERCHANT_ID || "";
    },
    get apiPassword() {
      return process.env.MPGS_API_PASSWORD || "";
    },
    get apiVersion() {
      return process.env.MPGS_API_VERSION || "100";
    },
    get webhookSecret() {
      return process.env.MPGS_WEBHOOK_SECRET || "";
    },
    get configured() {
      return Boolean(this.gatewayUrl && this.merchantId && this.apiPassword);
    },
  },
};
