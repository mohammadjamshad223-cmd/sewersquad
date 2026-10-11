/**
 * Central brand configuration — from the official Sewer Squad logo.
 * UI colors live as HSL tokens in src/app/globals.css; the hex values here are for PDFs and emails.
 *
 * Assets in public/brand/:
 *   logo.png            horizontal lockup (emblem + wordmark) for headers and sidebars
 *   logo-full.png       stacked lockup for the sign-in page
 *   logo-pdf.png        stacked lockup sized for PDF documents
 *   logo-mark.svg       "S" mark (vector) for favicons and compact spaces
 *   icon-*.png, apple-touch-icon.png   generated from the S mark
 */
export const brand = {
  name: "Sewer Squad",
  legalName: "Sewer Squad",
  tagline: "Commercial grease trap, septic & wastewater services",
  colors: {
    primary: "#002957",
    primaryStrong: "#001D3F",
    accent: "#65AA27",
    accentStrong: "#3F7A12",
    text: "#0F172A",
    muted: "#64748B",
    border: "#E2E8F0",
  },
  logoPath: "/brand/logo.png",
  logoSize: { width: 1176, height: 360 },
  fullLogoPath: "/brand/logo-full.png",
  fullLogoSize: { width: 900, height: 863 },
  pdfLogoFile: "public/brand/logo-pdf.png",
  markPath: "/brand/logo-mark.svg",
} as const;
