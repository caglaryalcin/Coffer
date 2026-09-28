import { createHash, randomBytes } from "node:crypto";
import * as oidc from "openid-client";
import { normalizeVaultIdentifier } from "./vault-store";
import {
  OIDC_CALLBACK_PATH,
  OidcSettingsStoreError,
  readOidcSettings,
  type OidcRuntimeSettings,
} from "./oidc-settings-store";

const FLOW_COOKIE = "coffer_oidc_flow";
const SESSION_COOKIE = "coffer_oidc_session";
const FLOW_TTL_MS = 10 * 60 * 1_000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const CALLBACK_PATH = OIDC_CALLBACK_PATH;

type OidcConfig = {
  issuer: URL;
  clientId: string;
  clientSecret: string;
  clientAuthMethod: "client_secret_basic" | "client_secret_post" | "none";
  providerName: string;
  scopes: string;
  configuredRedirectUri: string | null;
};

type OidcFlow = {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  returnTo: string;
  expiresAt: number;
};

export type OidcIdentity = {
  issuer: string;
  subject: string;
  email: string;
  name: string | null;
};

export type OidcPublicState = {
  enabled: boolean;
  providerName: string | null;
  authenticated: boolean;
  identity: { email: string; name: string | null } | null;
};

type OidcSession = { identity: OidcIdentity; expiresAt: number };

type OidcRuntimeGlobal = typeof globalThis & {
  __cofferOidcFlows?: Map<string, OidcFlow>;
  __cofferOidcSessions?: Map<string, OidcSession>;
};

const oidcRuntimeGlobal = globalThis as OidcRuntimeGlobal;
const flows = oidcRuntimeGlobal.__cofferOidcFlows ??= new Map<string, OidcFlow>();
const sessions = oidcRuntimeGlobal.__cofferOidcSessions ??= new Map<string, OidcSession>();
let discovered:
  | { key: string; promise: Promise<oidc.Configuration> }
  | null = null;

export class OidcError extends Error {
  constructor(
    readonly code: "not_configured" | "invalid_configuration" | "invalid_flow" | "invalid_identity",
    message: string,
  ) {
    super(message);
    this.name = "OidcError";
  }
}

export function oidcEnabled(): boolean {
  return readOidcSettings().enabled;
}

export function getOidcPublicState(request: Request): OidcPublicState {
  const config = readConfig(false);
  if (!config) {
    return { enabled: false, providerName: null, authenticated: false, identity: null };
  }
  const identity = getOidcIdentity(request);
  return {
    enabled: true,
    providerName: config.providerName,
    authenticated: Boolean(identity),
    identity: identity ? { email: identity.email, name: identity.name } : null,
  };
}

export function getOidcIdentity(request: Request): OidcIdentity | null {
  if (!oidcEnabled()) return null;
  pruneExpired();
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const session = sessions.get(hashToken(token));
  if (!session || session.expiresAt <= Date.now()) return null;
  return structuredClone(session.identity);
}

export async function beginOidcAuthorization(
  request: Request,
  returnTo = "/",
): Promise<Response> {
  const config = requireConfig();
  const client = await getClient(config);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const nonce = oidc.randomNonce();
  const state = oidc.randomState();
  const flowToken = randomToken();
  const redirectUri = redirectUriForRequest(config, request);
  const safeReturnTo = localReturnTo(returnTo);

  pruneExpired();
  flows.set(hashToken(flowToken), {
    state,
    nonce,
    codeVerifier,
    redirectUri,
    returnTo: safeReturnTo,
    expiresAt: Date.now() + FLOW_TTL_MS,
  });

  const authorizationUrl = oidc.buildAuthorizationUrl(client, {
    redirect_uri: redirectUri,
    scope: config.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    nonce,
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizationUrl.href,
      "Cache-Control": "no-store",
      "Set-Cookie": cookie(request, FLOW_COOKIE, flowToken, Math.ceil(FLOW_TTL_MS / 1_000)),
    },
  });
}

export async function completeOidcAuthorization(request: Request): Promise<Response> {
  const config = requireConfig();
  const flowToken = readCookie(request, FLOW_COOKIE);
  const flowKey = flowToken ? hashToken(flowToken) : "";
  const flow = flowKey ? flows.get(flowKey) : undefined;
  if (flowKey) flows.delete(flowKey);
  if (!flow || flow.expiresAt <= Date.now()) {
    throw new OidcError("invalid_flow", "The OIDC sign-in request is missing or expired.");
  }

  const client = await getClient(config);
  const callbackUrl = new URL(flow.redirectUri);
  callbackUrl.search = new URL(request.url).search;
  const tokens = await oidc.authorizationCodeGrant(client, callbackUrl, {
    pkceCodeVerifier: flow.codeVerifier,
    expectedNonce: flow.nonce,
    expectedState: flow.state,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims || typeof claims.sub !== "string" || typeof claims.iss !== "string") {
    throw new OidcError("invalid_identity", "The OIDC provider did not return a valid identity.");
  }

  let identityClaims: Record<string, unknown> = claims as Record<string, unknown>;
  if (typeof identityClaims.email !== "string" && tokens.access_token) {
    const userInfo = await oidc.fetchUserInfo(client, tokens.access_token, claims.sub);
    identityClaims = { ...identityClaims, ...userInfo };
  }
  const email = readVerifiedEmail(identityClaims);
  const identity: OidcIdentity = {
    issuer: claims.iss,
    subject: claims.sub,
    email,
    name: typeof identityClaims.name === "string" && identityClaims.name.trim()
      ? identityClaims.name.trim().slice(0, 80)
      : null,
  };
  const sessionToken = randomToken();
  sessions.set(hashToken(sessionToken), {
    identity,
    expiresAt: Date.now() + SESSION_TTL_MS,
  });

  const headers = new Headers({
    Location: addOidcResult(flow.returnTo, "success", request),
    "Cache-Control": "no-store",
  });
  headers.append("Set-Cookie", cookie(request, FLOW_COOKIE, "", 0));
  headers.append(
    "Set-Cookie",
    cookie(request, SESSION_COOKIE, sessionToken, Math.ceil(SESSION_TTL_MS / 1_000)),
  );
  return new Response(null, { status: 302, headers });
}

export function oidcFailureRedirect(request: Request): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: addOidcResult("/", "error", request),
      "Cache-Control": "no-store",
      "Set-Cookie": cookie(request, FLOW_COOKIE, "", 0),
    },
  });
}

export function endOidcSession(request: Request): Response {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) sessions.delete(hashToken(token));
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
      "Set-Cookie": cookie(request, SESSION_COOKIE, "", 0),
    },
  });
}

export async function validateOidcSettings(settings: OidcRuntimeSettings): Promise<void> {
  if (!settings.enabled) return;
  await getClient(configFromSettings(settings, true) as OidcConfig);
}

export function resetOidcRuntimeState(): void {
  flows.clear();
  sessions.clear();
  discovered = null;
}

function readConfig(throwOnPartial: boolean): OidcConfig | null {
  try {
    return configFromSettings(readOidcSettings(), throwOnPartial);
  } catch (error) {
    if (error instanceof OidcError) throw error;
    if (error instanceof OidcSettingsStoreError) {
      throw new OidcError("invalid_configuration", error.message);
    }
    throw error;
  }
}

function configFromSettings(
  settings: OidcRuntimeSettings,
  throwOnPartial: boolean,
): OidcConfig | null {
  if (!settings.enabled) return null;
  const issuerValue = settings.issuerUrl;
  const clientId = settings.clientId;
  const clientSecret = settings.clientSecret;
  if (!issuerValue || !clientId) {
    if (!throwOnPartial) {
      throw new OidcError(
        "invalid_configuration",
        "COFFER_OIDC_ISSUER_URL and COFFER_OIDC_CLIENT_ID must be configured together.",
      );
    }
    throw new OidcError("invalid_configuration", "The OIDC configuration is incomplete.");
  }

  let issuer: URL;
  try {
    issuer = new URL(issuerValue);
  } catch {
    throw new OidcError("invalid_configuration", "COFFER_OIDC_ISSUER_URL must be a valid URL.");
  }
  if (issuer.protocol !== "https:" && !isLoopbackHostname(issuer.hostname)) {
    throw new OidcError("invalid_configuration", "The OIDC issuer must use HTTPS.");
  }
  const scopes = settings.scopes;
  const configuredRedirectUri = optionalRedirectUri(settings.redirectUri);
  const clientAuthMethod = readClientAuthMethod(
    settings.clientAuthMethod,
    clientSecret,
  );
  return {
    issuer,
    clientId,
    clientSecret,
    clientAuthMethod,
    providerName: settings.providerName,
    scopes,
    configuredRedirectUri,
  };
}

function requireConfig(): OidcConfig {
  const config = readConfig(true);
  if (!config) throw new OidcError("not_configured", "OIDC is not configured.");
  return config;
}

async function getClient(config: OidcConfig): Promise<oidc.Configuration> {
  const key = `${config.issuer.href}\0${config.clientId}\0${config.clientSecret}\0${config.clientAuthMethod}`;
  if (!discovered || discovered.key !== key) {
    const clientAuthentication = config.clientAuthMethod === "client_secret_basic"
      ? oidc.ClientSecretBasic(config.clientSecret)
      : config.clientAuthMethod === "client_secret_post"
        ? oidc.ClientSecretPost(config.clientSecret)
        : oidc.None();
    const promise = oidc.discovery(
      config.issuer,
      config.clientId,
      config.clientSecret || undefined,
      clientAuthentication,
      isLoopbackHostname(config.issuer.hostname)
        ? { execute: [oidc.allowInsecureRequests] }
        : undefined,
    );
    discovered = { key, promise };
    promise.catch(() => {
      if (discovered?.promise === promise) discovered = null;
    });
  }
  return discovered.promise;
}

function readClientAuthMethod(
  value: string | undefined,
  clientSecret: string,
): OidcConfig["clientAuthMethod"] {
  const candidate = value?.trim().toLowerCase() || (clientSecret ? "client_secret_basic" : "none");
  if (
    candidate !== "client_secret_basic" &&
    candidate !== "client_secret_post" &&
    candidate !== "none"
  ) {
    throw new OidcError(
      "invalid_configuration",
      "COFFER_OIDC_CLIENT_AUTH_METHOD must be client_secret_basic, client_secret_post, or none.",
    );
  }
  if (candidate !== "none" && !clientSecret) {
    throw new OidcError(
      "invalid_configuration",
      "COFFER_OIDC_CLIENT_SECRET is required for the selected client authentication method.",
    );
  }
  return candidate;
}

function readVerifiedEmail(claims: Record<string, unknown>): string {
  if (typeof claims.email !== "string" || claims.email_verified === false) {
    throw new OidcError(
      "invalid_identity",
      "The OIDC provider must return a verified email address.",
    );
  }
  return normalizeVaultIdentifier(claims.email);
}

function optionalRedirectUri(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new OidcError("invalid_configuration", "COFFER_OIDC_REDIRECT_URI must be a valid URL.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== CALLBACK_PATH) {
    throw new OidcError(
      "invalid_configuration",
      `COFFER_OIDC_REDIRECT_URI must point to ${CALLBACK_PATH}.`,
    );
  }
  if (parsed.protocol !== "https:" && !isLoopbackHostname(parsed.hostname)) {
    throw new OidcError("invalid_configuration", "The OIDC redirect URI must use HTTPS.");
  }
  return parsed.href;
}

function redirectUriForRequest(config: OidcConfig, request: Request): string {
  return config.configuredRedirectUri ?? new URL(CALLBACK_PATH, externalOrigin(request)).href;
}

function externalOrigin(request: Request): string {
  const requestUrl = new URL(request.url);
  if (process.env.COFFER_TRUST_PROXY !== "1") return requestUrl.origin;
  const protocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
  const host = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim().toLowerCase();
  if ((protocol !== "http" && protocol !== "https") || !host || !/^[a-z0-9.:[\]-]+(?::\d{1,5})?$/u.test(host)) {
    return requestUrl.origin;
  }
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return requestUrl.origin;
  }
}

function addOidcResult(returnTo: string, result: "success" | "error", request: Request): string {
  const url = new URL(localReturnTo(returnTo), externalOrigin(request));
  url.searchParams.set("oidc", result);
  return `${url.pathname}${url.search}${url.hash}`;
}

function localReturnTo(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  try {
    const parsed = new URL(value, "http://coffer.local");
    return parsed.origin === "http://coffer.local"
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : "/";
  } catch {
    return "/";
  }
}

function cookie(
  request: Request,
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    requestIsSecure(request) ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

function requestIsSecure(request: Request): boolean {
  if (process.env.COFFER_TRUST_PROXY !== "1") return new URL(request.url).protocol === "https:";
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  return forwardedProtocol === "https" || new URL(request.url).protocol === "https:";
}

function readCookie(request: Request, name: string): string {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{32,256}$/u.test(value) ? value : "";
  }
  return "";
}

function randomToken(): string {
  return Buffer.from(randomBytes(32)).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [key, flow] of flows) if (flow.expiresAt <= now) flows.delete(key);
  for (const [key, session] of sessions) if (session.expiresAt <= now) sessions.delete(key);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
