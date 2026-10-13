import "server-only";
import { createHmac } from "node:crypto";
import { env } from "./env";
import { safeEqual } from "./crypto";

/**
 * Signed, expiring links to one job's completion paperwork (photos, manifest, invoice) for
 * customers who don't have a portal login. Short enough for a text message:
 * base64url(job uuid) . expiry (base-36 seconds) . 96-bit HMAC.
 */
const DAYS = 180;

function sign(payload: string) {
  return createHmac("sha256", env().APP_ENCRYPTION_KEY).update(`job-share:${payload}`).digest("base64url").slice(0, 16);
}

export function jobShareToken(jobId: string, days = DAYS) {
  const id = Buffer.from(jobId.replace(/-/g, ""), "hex").toString("base64url");
  const exp = Math.floor(Date.now() / 1000 + days * 86_400).toString(36);
  return `${id}.${exp}.${sign(`${id}.${exp}`)}`;
}

export function jobShareUrl(jobId: string) {
  return `${env().APP_URL.replace(/\/$/, "")}/s/${jobShareToken(jobId)}`;
}

/** The job id for a valid, unexpired token, else null. */
export function verifyJobShareToken(token: string): string | null {
  const [id, exp, sig] = token.split(".");
  if (!id || !exp || !sig || !/^[A-Za-z0-9_-]{22}$/.test(id) || !/^[0-9a-z]{1,10}$/.test(exp)) return null;
  if (!safeEqual(sig, sign(`${id}.${exp}`))) return null;
  if (parseInt(exp, 36) * 1000 < Date.now()) return null;
  const hex = Buffer.from(id, "base64url").toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
