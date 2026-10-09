import { describe, expect, it } from "vitest";
import { constantTimeEqual, decryptSecret, encryptSecret, generateToken } from "./crypto";

const KEY = Buffer.alloc(32, 1).toString("base64");
const OTHER_KEY = Buffer.alloc(32, 2).toString("base64");

describe("encryptSecret / decryptSecret", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("sk_live_123", KEY);
    const b = encryptSecret("sk_live_123", KEY);
    expect(a).not.toBe(b);
    expect(a.split(":")).toHaveLength(3);
    expect(decryptSecret(a, KEY)).toBe("sk_live_123");
  });

  it("fails with the wrong key or tampered ciphertext", () => {
    const encrypted = encryptSecret("secret", KEY);
    expect(() => decryptSecret(encrypted, OTHER_KEY)).toThrow();
    const [iv, tag, data] = encrypted.split(":") as [string, string, string];
    const flipped = Buffer.from(data, "base64");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => decryptSecret(`${iv}:${tag}:${flipped.toString("base64")}`, KEY)).toThrow();
  });

  it("rejects malformed input and bad keys", () => {
    expect(() => decryptSecret("nope", KEY)).toThrow(/iv:tag:ciphertext/);
    expect(() => encryptSecret("x", Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("tokens", () => {
  it("generates 32-byte url-safe tokens", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(token);
  });

  it("compares in constant time", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});
