/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

// Content-Security-Policy: allow the app's own assets, inline styles/scripts
// required by Next.js + Tailwind, data/blob URLs (QR codes, fonts), same-origin
// websockets (Socket.IO) and AWS S3 (document storage / images).
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.amazonaws.com https://cdc.construction https://res.cloudinary.com",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss: https://*.amazonaws.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // Camera is required for QR-code scanning; microphone/geolocation are not used.
    value: "camera=(self), microphone=(), geolocation=()",
  },
  // HSTS only in production so it does not pin localhost to HTTPS during dev.
  ...(isProd
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

const nextConfig = {
  images: {
    remotePatterns: [
      // new URL("https://cdc.construction/images/team/**"),
      new URL("https://res.cloudinary.com/**"),
      new URL("https://hrcdc.s3.eu-west-2.amazonaws.com/**"),
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
