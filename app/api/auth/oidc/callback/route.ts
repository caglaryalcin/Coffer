import {
  completeOidcAuthorization,
  oidcFailureRedirect,
} from "@/lib/server/oidc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return await completeOidcAuthorization(request);
  } catch {
    return oidcFailureRedirect(request);
  }
}
