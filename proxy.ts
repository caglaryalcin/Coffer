import { NextResponse } from "next/server";
import { SECURITY_HEADERS } from "./lib/security-headers";

function secure(response: NextResponse) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export function proxy() {
  return secure(NextResponse.next());
}

export const config = {
  matcher: "/:path*",
};
