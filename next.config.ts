import type { NextConfig } from "next";

function normalizeAllowedDevOrigin(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    return new URL(candidate).hostname.toLowerCase();
  } catch {
    return candidate.toLowerCase();
  }
}

const allowedDevOrigins = (process.env.COFFER_ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map(normalizeAllowedDevOrigin)
  .filter((value): value is string => Boolean(value));

const nextConfig: NextConfig = {
  // Emit the minimal Node.js runtime bundle used by the production image.
  output: "standalone",
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
};

export default nextConfig;
