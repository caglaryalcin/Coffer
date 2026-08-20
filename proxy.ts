import { NextResponse, type NextRequest } from "next/server";
import { SECURITY_HEADERS } from "./lib/security-headers";

function secure(response: NextResponse, demoMode: boolean) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  if (demoMode) {
    response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  }
  return response;
}

function demoDestination(request: NextRequest) {
  const configuredUrl = process.env.COFFER_DEMO_URL?.trim();
  if (configuredUrl) {
    try {
      const url = new URL(configuredUrl);
      if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) {
        return url;
      }
    } catch {
      // Invalid explicit configuration fails closed below.
    }
    return null;
  }

  const configuredPort = Number(process.env.COFFER_DEMO_PORT);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65_535
    ? configuredPort
    : 3_001;
  const url = request.nextUrl.clone();
  if (url.hostname === "localhost") {
    url.hostname = "127.0.0.1";
  }
  url.port = String(port);
  url.pathname = "/demo";
  url.search = "";
  url.hash = "";
  return url;
}

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const demoMode = process.env.COFFER_DEMO_MODE === "1";

  if (demoMode && pathname === "/") {
    const demoUrl = request.nextUrl.clone();
    demoUrl.pathname = "/demo";
    return secure(NextResponse.redirect(demoUrl, 307), demoMode);
  }

  if (!demoMode && (pathname === "/demo" || pathname === "/demo/")) {
    const destination = demoDestination(request);
    if (!destination || destination.origin === request.nextUrl.origin) {
      return secure(NextResponse.json(
        { error: { code: "demo_unavailable", message: "The separate demo endpoint is not configured correctly." } },
        { status: 503 },
      ), demoMode);
    }
    return secure(NextResponse.redirect(destination, 307), demoMode);
  }

  if (demoMode && (pathname === "/api" || pathname.startsWith("/api/"))) {
    return secure(NextResponse.json(
      { error: { code: "demo_unavailable", message: "Server APIs are unavailable in demo mode." } },
      { status: 404 },
    ), demoMode);
  }

  return secure(NextResponse.next(), demoMode);
}

export const config = {
  matcher: "/:path*",
};
