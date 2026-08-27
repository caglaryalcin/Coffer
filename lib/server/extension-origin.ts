const EXTENSION_ORIGIN_PATTERN = /^(?:moz|chrome)-extension:\/\/[A-Za-z0-9-]+$/u;

export function isExtensionRequest(request: Request): boolean {
  return extensionRequestOrigin(request) !== null;
}

export function extensionCorsHeaders(
  request: Request,
  methods = "GET, POST, OPTIONS",
): HeadersInit | null {
  const origin = extensionRequestOrigin(request);
  if (!origin) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin, Access-Control-Request-Headers",
  };
}

function extensionRequestOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (typeof origin !== "string") return null;
  return normalizeExtensionOrigin(origin);
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
