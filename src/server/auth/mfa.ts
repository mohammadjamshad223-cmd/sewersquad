import "server-only";
import { createTOTPKeyURI, verifyTOTPWithGracePeriod } from "@oslojs/otp";
import { encodeBase32UpperCaseNoPadding } from "@oslojs/encoding";
import { randomBytes } from "node:crypto";
import { decryptString, encryptString, sha256Hex } from "../crypto";

const PERIOD = 30;
const DIGITS = 6;

export function generateTotpSecret(): Uint8Array {
  return new Uint8Array(randomBytes(20));
}

export function totpUri(secret: Uint8Array, accountEmail: string, issuer = "Sewer Squad") {
  return createTOTPKeyURI(issuer, accountEmail, secret, PERIOD, DIGITS);
}

export function secretToBase32(secret: Uint8Array) {
  return encodeBase32UpperCaseNoPadding(secret);
}

export function encryptSecret(secret: Uint8Array): string {
  return encryptString(Buffer.from(secret).toString("base64"));
}

export function decryptSecret(enc: string): Uint8Array {
  return new Uint8Array(Buffer.from(decryptString(enc), "base64"));
}

export function verifyTotp(secret: Uint8Array, code: string): boolean {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  return verifyTOTPWithGracePeriod(secret, PERIOD, DIGITS, clean, PERIOD);
}

export function generateRecoveryCodes(count = 8): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map((c) => sha256Hex(c)) };
}
