// Central, validated access to environment configuration.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const env = {
  get appUrl() {
    return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  },
  get storageDir() {
    return process.env.STORAGE_DIR || "./storage";
  },
  get encryptionKey(): Buffer {
    const key = Buffer.from(required("DATA_ENCRYPTION_KEY"), "base64");
    if (key.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
    return key;
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
