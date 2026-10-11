/**
 * Central brand configuration.
 *
 * NOTE: The repository did not contain official Sewer Squad logo files or brand colors at the
 * time this platform was built. These values are neutral placeholders. Replace:
 *   - public/brand/logo.svg, public/brand/logo-mark.svg, public/brand/icon-192.png, icon-512.png
 *   - the hex values below (used in PDFs and emails)
 *   - the matching HSL variables in src/app/globals.css (used by the UI)
 */
export const brand = {
  name: "Sewer Squad",
  legalName: "Sewer Squad",
  tagline: "Commercial grease trap, septic & wastewater services",
  colors: {
    primary: "#0E3A5B",
    primaryStrong: "#0A2A42",
    accent: "#2F9E6E",
    text: "#0F172A",
    muted: "#64748B",
    border: "#E2E8F0",
  },
  logoPath: "/brand/logo.svg",
  markPath: "/brand/logo-mark.svg",
} as const;
