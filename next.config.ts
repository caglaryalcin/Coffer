import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit the minimal Node.js runtime bundle used by the production image.
  output: "standalone",
};

export default nextConfig;
