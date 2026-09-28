import {
  endOidcSession,
  getOidcPublicState,
  OidcError,
} from "@/lib/server/oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Response {
  try {
    return Response.json(getOidcPublicState(request), {
      headers: responseHeaders(),
    });
  } catch (error) {
    return oidcErrorResponse(error);
  }
}

export function POST(request: Request): Response {
  if (!isSameOriginRequest(request)) {
    return Response.json(
      { error: { code: "invalid_origin", message: "A same-origin request is required." } },
      { status: 403, headers: responseHeaders() },
    );
  }
  return endOidcSession(request);
}

function oidcErrorResponse(error: unknown): Response {
  const message = error instanceof OidcError
    ? error.message
    : "The OIDC configuration is unavailable.";
  return Response.json(
    { error: { code: "oidc_configuration_error", message } },
    { status: 500, headers: responseHeaders() },
  );
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (origin !== parsed.origin) return false;
    if (parsed.origin === new URL(request.url).origin) return true;
    if (process.env.COFFER_TRUST_PROXY !== "1") return false;
    const protocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
    const host = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
    return Boolean(protocol && host && parsed.origin === new URL(`${protocol}://${host}`).origin);
  } catch {
    return false;
  }
}

function responseHeaders(): Headers {
  const headers = new Headers();
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}
