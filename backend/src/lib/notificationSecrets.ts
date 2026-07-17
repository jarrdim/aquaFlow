import crypto from "crypto";

function encryptionKey() {
  const source =
    process.env.NOTIFICATION_ENCRYPTION_KEY?.trim() ||
    process.env.JWT_SECRET?.trim();
  if (!source || source.length < 24) {
    throw Object.assign(
      new Error(
        "Set NOTIFICATION_ENCRYPTION_KEY to a long random value before saving provider credentials.",
      ),
      { status: 503 },
    );
  }
  return crypto.createHash("sha256").update(source).digest();
}

export function encryptProviderSecret(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptProviderSecret(value: string) {
  const [version, ivText, tagText, encryptedText] = value.split(":");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new Error("The stored provider credential is invalid.");
  }
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivText, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
