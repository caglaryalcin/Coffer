import { beginOidcAuthorization, OidcError } from "@/lib/server/oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const returnTo = new URL(request.url).searchParams.get("returnTo") ?? "/";
    return await beginOidcAuthorization(request, returnTo);
  } catch (error) {
    const message = error instanceof OidcError
      ? error.message
      : "Coffer could not start the OIDC sign-in flow.";
    return Response.json(
      { error: { code: "oidc_unavailable", message } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
