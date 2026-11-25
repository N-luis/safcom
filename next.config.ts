import type { NextConfig } from "next";

/**
 * Security headers on every response.
 *
 * - The site cannot be put inside another site's frame (clickjacking):
 *   X-Frame-Options and the CSP frame-ancestors directive, same origin only.
 * - Browsers do not guess file types (X-Content-Type-Options), so an uploaded
 *   photo is never run as a script.
 * - Links to other sites carry only the origin, never the page address, which
 *   can name a case (Referrer-Policy).
 * - HTTPS is remembered for two years (Strict-Transport-Security).
 * - Only the features SafeComm uses are allowed: location (the "use my
 *   location" pin) and the camera (taking a photo for a report), on SafeComm
 *   itself; no microphone, payment or USB.
 * - The CSP below covers what can be locked without breaking the app: no
 *   plugins (object-src), no <base> tag redirection, forms submit only to
 *   SafeComm, and no framing. Scripts and styles are not restricted by it -
 *   Next.js and MUI inline them, and a script policy needs per-request nonces
 *   to be added safely.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(self), microphone=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
