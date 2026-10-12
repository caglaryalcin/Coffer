import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit the minimal Node.js runtime bundle used by the production image.
  output: "standalone",
  async headers() {
    const crossOriginImageHeaders = [
      { key: "Access-Control-Allow-Origin", value: "*" },
      { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
    ];

    return [
      { source: "/coffer.png", headers: crossOriginImageHeaders },
      { source: "/coffer.svg", headers: crossOriginImageHeaders },
    ];
  },
};

export default nextConfig;
