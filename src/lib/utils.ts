import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function formatAddress(a: { addressLine1: string; addressLine2?: string | null; city: string; state: string; postalCode: string }): string {
  return [a.addressLine1, a.addressLine2, `${a.city}, ${a.state} ${a.postalCode}`].filter(Boolean).join(", ");
}

export function mapsUrl(address: string, provider: "google" | "apple" = "google"): string {
  const q = encodeURIComponent(address);
  return provider === "apple" ? `https://maps.apple.com/?daddr=${q}` : `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

export function telHref(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
