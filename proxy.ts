import { NextRequest, NextResponse } from "next/server";
import { SECURITY_HEADERS } from "./lib/security-headers";

function secure(response: NextResponse, request: NextRequest) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  if (request.nextUrl.pathname.startsWith("/brands/")) {
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
