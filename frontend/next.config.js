/** @type {import('next').NextConfig} */
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

module.exports = nextConfig;
