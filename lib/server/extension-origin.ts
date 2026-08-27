const EXTENSION_ORIGIN_PATTERN = /^(?:moz|chrome)-extension:\/\/[A-Za-z0-9-]+$/u;
const ALLOWED_EXTENSION_ORIGINS = new Set(parseAllowedExtensionOrigins());

export function isTrustedExtensionRequest(request: Request): boolean {
  return trustedExtensionOrigin(request) !== null;
}

export function extensionCorsHeaders(
  request: Request,
  methods = "GET, POST, OPTIONS",
): HeadersInit | null {
  const origin = trustedExtensionOrigin(request);
  if (!origin) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin, Access-Control-Request-Headers",
  };
}

function trustedExtensionOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (typeof origin !== "string") return null;
  const canonicalOrigin = normalizeExtensionOrigin(origin);
  if (!canonicalOrigin || !ALLOWED_EXTENSION_ORIGINS.has(canonicalOrigin)) return null;
  return canonicalOrigin;
}

function parseAllowedExtensionOrigins(): string[] {
  return [
    process.env.COFFER_ALLOWED_EXTENSION_ORIGINS ?? "",
    process.env.COFFER_ALLOWED_DEV_ORIGINS ?? "",
  ]
    .flatMap((value) => value.split(","))
    .flatMap(extensionOriginCandidates)
    .map(normalizeExtensionOrigin)
    .filter((value): value is string => Boolean(value));
}

function extensionOriginCandidates(value: string): string[] {
  const candidate = value.trim();
  if (!candidate) return [];
  if (candidate.startsWith("moz-extension://") || candidate.startsWith("chrome-extension://")) {
    return [candidate];
  }
  if (/^[A-Za-z0-9-]+$/u.test(candidate)) {
    return [`moz-extension://${candidate}`, `chrome-extension://${candidate}`];
  }
  return [];
}

function normalizeExtensionOrigin(value: string | null): string | null {
  if (typeof value !== "string" || !EXTENSION_ORIGIN_PATTERN.test(value)) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "moz-extension:" && url.protocol !== "chrome-extension:") ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "" && url.pathname !== "/")
    ) {
      return null;
    }
    return `${url.protocol}//${url.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}
