import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content Security Policy. Next.js App Router injects inline bootstrap scripts, so without a
 * per-request nonce (which would force every page to render dynamically) `'unsafe-inline'` is
 * required for scripts; everything else is locked to this origin. Images allow https: because
 * document photos redirect to short-lived signed object-storage URLs. Stripe Checkout is a
 * top-level redirect, allowed as a form target for the no-JS fallback.
 */
// Google Maps (only when a key is set at build time): sources from Google's Maps JavaScript API
// CSP guide. 'unsafe-eval' is not included; add it only if the map reports CSP violations.
const maps = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
const g = (list: string) => (maps ? ` ${list}` : "");

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${g("https://*.googleapis.com https://*.gstatic.com https://*.google.com blob:")}`,
  `style-src 'self' 'unsafe-inline'${g("https://fonts.googleapis.com")}`,
  "img-src 'self' data: blob: https:",
  `font-src 'self' data:${g("https://fonts.gstatic.com")}`,
  `connect-src 'self'${isDev ? " ws:" : ""}${g("https://*.googleapis.com https://*.google.com https://*.gstatic.com data: blob:")}`,
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  `frame-src ${maps ? "https://*.google.com" : "'none'"}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://checkout.stripe.com",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@node-rs/argon2", "@prisma/client"],
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
