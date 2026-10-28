/** @type {import('next').NextConfig} */
const { randomUUID } = require("node:crypto");
const withSerwistInit = require("@serwist/next").default;

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Precache the offline fallback page so it can be shown for any uncached
  // navigation while the device has no connection.
  additionalPrecacheEntries: [
    { url: "/~offline", revision: randomUUID() },
  ],
  // A service worker in development can serve stale assets between rebuilds.
  // Use `npm run build && npm start` to test the PWA/offline behaviour.
  disable: process.env.NODE_ENV === "development",
});

const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
    ],
  },

  // ── Performance optimizations ─────────────────────────────────────────────

  // Compiler optimizations — removes console.log in production
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },

  // Experimental: optimize package imports to reduce bundle size
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "date-fns",
      "@tanstack/react-query",
      "@reduxjs/toolkit",
    ],
  },
};

module.exports = withSerwist(nextConfig);
