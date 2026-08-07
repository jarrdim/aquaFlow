import crypto from "crypto";

type PaymentLinkPayload = {
  accountId: string;
  noticeId?: string;
  expiresAt: string;
};

function key() {
  const secret = process.env.PAYMENT_LINK_SECRET || process.env.JWT_SECRET;
  if (!secret) throw new Error("PAYMENT_LINK_SECRET or JWT_SECRET is required");
  return crypto.createHash("sha256").update(secret).digest();
}

export function createPaymentLinkToken(payload: PaymentLinkPayload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function readPaymentLinkToken(token: string): PaymentLinkPayload {
  try {
    const value = Buffer.from(token, "base64url");
    if (value.length < 29) throw new Error("Invalid token");
    const iv = value.subarray(0, 12);
    const tag = value.subarray(12, 28);
    const encrypted = value.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    const payload = JSON.parse(
      Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"),
    ) as PaymentLinkPayload;
    if (
      !/^\d+$/.test(payload.accountId) ||
      (payload.noticeId !== undefined && !/^\d+$/.test(payload.noticeId))
    )
      throw new Error("Invalid token payload");
    if (!payload.expiresAt || new Date(payload.expiresAt) < new Date())
      throw Object.assign(new Error("This payment link has expired"), { status: 410 });
    return payload;
  } catch (error: any) {
    if (error?.status === 410) throw error;
    throw Object.assign(new Error("Invalid payment link"), { status: 400 });
  }
}

export function publicAppUrl() {
  return (process.env.PUBLIC_APP_URL || "https://samdamte.co.ke").replace(/\/$/, "");
}
