/**
 * Normalizes a phone number to E.164 for SMS (Twilio requires it). Numbers are stored as typed,
 * e.g. "(713) 555-0101". 10-digit numbers are treated as US/Canada (+1). Returns null when the
 * number cannot be interpreted.
 */
export function toE164(raw: string | null | undefined, defaultCountryCode = "1"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s*(?:x|ext\.?)\s*\d+$/i, ""); // drop extensions
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+${defaultCountryCode}${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
