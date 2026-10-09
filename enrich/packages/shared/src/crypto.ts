import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

function keyFromBase64(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes");
  return key;
}

/** AES-256-GCM. Output format: `iv:tag:ciphertext`, each part base64. */
export function encryptSecret(plaintext: string, keyBase64: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyFromBase64(keyBase64), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString("base64")).join(":");
}

export function decryptSecret(encoded: string, keyBase64: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 3) throw new Error("Encrypted value must have the form iv:tag:ciphertext");
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, "base64")) as [Buffer, Buffer, Buffer];
  const decipher = createDecipheriv(ALGORITHM, keyFromBase64(keyBase64), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** 32 random bytes, base64url: used for per-client webhook tokens. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    // Still spend a comparison so the length mismatch is not an early exit.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
