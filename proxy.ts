import { NextRequest, NextResponse } from "next/server";
import { SECURITY_HEADERS } from "./lib/security-headers";

const CROSS_ORIGIN_IMAGE_PATHS = new Set([
  "/coffer.png",
  "/coffer.svg",
]);

function secure(response: NextResponse, request: NextRequest) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  if (
    request.nextUrl.pathname.startsWith("/brands/") ||
    CROSS_ORIGIN_IMAGE_PATHS.has(request.nextUrl.pathname)
  ) {
    response.headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    response.headers.set("Access-Control-Allow-Origin", "*");
  }
  return response;
}

export function proxy(request: NextRequest) {
  return secure(NextResponse.next(), request);
}

export const config = {
  matcher: "/:path*",
};
