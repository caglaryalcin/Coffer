import {
  decodeFixedAuthProof,
  isEncryptedVaultPayload,
  isVaultCryptoHeader,
  MAX_SESSION_TTL_MS,
  VaultStore,
  VaultStoreError,
} from "@/lib/server/vault-store";
import { extensionCorsHeaders, isExtensionRequest } from "@/lib/server/extension-origin";
import { isIP } from "node:net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 24 * 1024 * 1024;
const SESSION_COOKIE = "coffer_session";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
const REMEMBERED_SESSION_MAX_AGE_SECONDS = MAX_SESSION_TTL_MS / 1_000;
const store = new VaultStore();

type JsonObject = Record<string, unknown>;

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    return json(await store.getAuthenticatedBootstrap(sessionToken(request)));
  } catch (error) {
    return errorResponse(error);
  }
}

export function OPTIONS(request: Request): Response {
  const corsHeaders = extensionCorsHeaders(request, "POST, OPTIONS");
  if (!corsHeaders) {
    return new Response(null, { status: 204, headers: responseHeaders() });
  }
  return new Response(null, { status: 204, headers: responseHeaders(corsHeaders) });
}

export async function POST(request: Request): Promise<Response> {
  let action: string | null = null;
  try {
    const body = await readJsonBody(request);
    if (!isJsonObject(body) || typeof body.action !== "string") {
      throw new RequestError(400, "invalid_request", "A valid action is required.");
    }
    action = body.action;

    let response: Response;
    switch (body.action) {
      case "identify":
        response = await identify(request, body);
        break;
      case "setup":
        response = await setup(request, body);
        break;
      case "login":
        response = await login(request, body);
        break;
      case "claim_legacy":
        response = await claimLegacy(request, body);
        break;
      case "save":
        response = await save(request, body);
        break;
      case "change_password":
        response = await changePassword(request, body);
        break;
      case "delete_account":
        response = await deleteAccount(request, body);
        break;
      case "logout":
        response = logout(request, body);
        break;
      default:
        throw new RequestError(400, "invalid_action", "The action is not supported.");
    }
    return withExtensionCors(request, response, action);
  } catch (error) {
    return withExtensionCors(request, errorResponse(error), action);
  }
}

async function identify(request: Request, body: JsonObject): Promise<Response> {
  requireSameOrExtensionOrigin(request);
  if (!hasExactKeys(body, ["action", "identifier"])) throw invalidSchema();
  if (body.action !== "identify" || typeof body.identifier !== "string") {
    throw invalidSchema();
  }
  return json(await store.identify(body.identifier, clientRateKey(request)));
}

async function setup(request: Request, body: JsonObject): Promise<Response> {
  requireSameOrigin(request);
  if (!hasExactKeysWithOptional(
    body,
    ["action", "identifier", "authProof", "header", "payload"],
    ["rememberLogin"],
  )) {
    throw invalidSchema();
  }
  const authProof = decodeFixedAuthProof(body.authProof);
  const rememberLogin = readRememberLogin(body);
  if (
    body.action !== "setup" ||
    typeof body.identifier !== "string" ||
    !authProof ||
    !isVaultCryptoHeader(body.header) ||
    !isEncryptedVaultPayload(body.payload)
  ) {
    throw invalidSchema();
  }

  const result = await store.setup({
    identifier: body.identifier,
    authProof,
    header: body.header,
    payload: body.payload,
  }, clientRateKey(request), {
    sessionTtlMs: sessionTtlMs(rememberLogin),
  });
  return json(
    { configured: true, revision: result.revision },
    {
      status: 201,
      headers: {
        "Set-Cookie": sessionCookie(
          request,
          result.sessionToken,
          sessionMaxAgeSeconds(rememberLogin),
        ),
      },
    },
  );
}

async function login(request: Request, body: JsonObject): Promise<Response> {
  requireSameOrExtensionOrigin(request);
  const hasIdentifier = hasExactKeysWithOptional(
    body,
    ["action", "identifier", "authProof"],
    ["rememberLogin"],
  );
  const hasSessionOnly = hasExactKeysWithOptional(
    body,
    ["action", "authProof"],
    ["rememberLogin"],
  );
  if (!hasIdentifier && !hasSessionOnly) throw invalidSchema();
  const authProof = decodeFixedAuthProof(body.authProof);
  const rememberLogin = readRememberLogin(body);
  if (
    body.action !== "login" ||
    !authProof ||
    (hasIdentifier && typeof body.identifier !== "string")
  ) throw invalidSchema();

  const result = hasIdentifier
    ? await store.login(body.identifier as string, authProof, clientRateKey(request), {
        sessionTtlMs: sessionTtlMs(rememberLogin),
      })
    : await store.loginWithSession(
        sessionToken(request),
        authProof,
        clientRateKey(request),
        { sessionTtlMs: sessionTtlMs(rememberLogin) },
      );
  return json(
    { revision: result.revision, payload: result.payload, legacy: result.legacy },
    {
      headers: {
        "Set-Cookie": sessionCookie(
          request,
          result.sessionToken,
          sessionMaxAgeSeconds(rememberLogin),
        ),
      },
    },
  );
}

async function claimLegacy(request: Request, body: JsonObject): Promise<Response> {
  requireSameOrigin(request);
  if (!hasExactKeys(body, ["action", "identifier"])) throw invalidSchema();
  if (body.action !== "claim_legacy" || typeof body.identifier !== "string") {
    throw invalidSchema();
  }
  return json(await store.claimLegacy(sessionToken(request), body.identifier));
}

async function save(request: Request, body: JsonObject): Promise<Response> {
  requireSameOrigin(request);
  if (!hasExactKeys(body, ["action", "vaultId", "expectedRevision", "payload"])) {
    throw invalidSchema();
  }
  if (
    body.action !== "save" ||
    typeof body.vaultId !== "string" ||
    !isRevision(body.expectedRevision) ||
    !isEncryptedVaultPayload(body.payload)
  ) {
    throw invalidSchema();
  }

  const result = await store.save({
    sessionToken: sessionToken(request),
    vaultId: body.vaultId,
    expectedRevision: body.expectedRevision,
    payload: body.payload,
  });
  return json(result);
}

async function changePassword(request: Request, body: JsonObject): Promise<Response> {
  requireSameOrigin(request);
  if (!hasExactKeys(body, [
    "action",
    "vaultId",
    "expectedRevision",
    "currentAuthProof",
    "nextAuthProof",
    "header",
  ])) {
    throw invalidSchema();
  }
  const currentAuthProof = decodeFixedAuthProof(body.currentAuthProof);
  const nextAuthProof = decodeFixedAuthProof(body.nextAuthProof);
  if (
    body.action !== "change_password" ||
    typeof body.vaultId !== "string" ||
    !isRevision(body.expectedRevision) ||
    !currentAuthProof ||
    !nextAuthProof ||
    !isVaultCryptoHeader(body.header)
  ) {
    throw invalidSchema();
  }

  const result = await store.changePassword({
    sessionToken: sessionToken(request),
    vaultId: body.vaultId,
    expectedRevision: body.expectedRevision,
    currentAuthProof,
    nextAuthProof,
    header: body.header,
    rateKey: clientRateKey(request),
  });
  return json(
    { revision: result.revision, updatedAt: result.updatedAt },
    { headers: { "Set-Cookie": sessionCookie(request, result.sessionToken) } },
  );
}

async function deleteAccount(request: Request, body: JsonObject): Promise<Response> {
  requireSameOrigin(request);
  if (!hasExactKeys(body, ["action", "vaultId", "authProof"])) {
    throw invalidSchema();
  }
  const authProof = decodeFixedAuthProof(body.authProof);
  if (
    body.action !== "delete_account" ||
    typeof body.vaultId !== "string" ||
    !authProof
  ) {
    throw invalidSchema();
  }

  await store.deleteAccount({
    sessionToken: sessionToken(request),
    vaultId: body.vaultId,
    authProof,
    rateKey: clientRateKey(request),
  });
  return new Response(null, {
    status: 204,
    headers: responseHeaders({ "Set-Cookie": clearSessionCookie(request) }),
  });
}

function logout(request: Request, body: JsonObject): Response {
  requireSameOrigin(request);
  if (!hasExactKeys(body, ["action"]) || body.action !== "logout") {
    throw invalidSchema();
  }

  store.logout(sessionToken(request));
  return new Response(null, {
    status: 204,
    headers: responseHeaders({ "Set-Cookie": clearSessionCookie(request) }),
  });
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.split(";", 1)[0].trim() !== "application/json") {
    throw new RequestError(415, "unsupported_media_type", "JSON is required.");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    if (!/^\d+$/.test(contentLength)) {
      throw new RequestError(400, "invalid_request", "Invalid content length.");
    }
    if (Number(contentLength) > MAX_REQUEST_BYTES) {
      throw new RequestError(413, "payload_too_large", "The request is too large.");
    }
  }
  if (!request.body) {
    throw new RequestError(400, "invalid_json", "A JSON body is required.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new RequestError(413, "payload_too_large", "The request is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, "invalid_json", "The JSON body is invalid.");
  }
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }

  let suppliedOrigin: string;
  try {
    const parsedOrigin = new URL(origin);
    suppliedOrigin = parsedOrigin.origin;
    if (origin !== suppliedOrigin) throw new Error("Non-canonical origin");
  } catch {
    return false;
  }
  const requestOrigin = new URL(request.url).origin;
  const forwardedOrigin = trustedForwardedOrigin(request);
  return suppliedOrigin === requestOrigin || suppliedOrigin === forwardedOrigin;
}

function requireSameOrigin(request: Request): void {
  if (!isSameOriginRequest(request)) {
    throw new RequestError(403, "invalid_origin", "A same-origin request is required.");
  }
}

function requireSameOrExtensionOrigin(request: Request): void {
  if (!isSameOriginRequest(request) && !isExtensionRequest(request)) {
    throw new RequestError(403, "invalid_origin", "A same-origin or browser-extension request is required.");
  }
}

function withExtensionCors(request: Request, response: Response, action: string | null): Response {
  if (action !== "identify" && action !== "login") return response;
  const corsHeaders = extensionCorsHeaders(request, "POST, OPTIONS");
  if (!corsHeaders) return response;
  const headers = new Headers(corsHeaders);
  headers.forEach((value, key) => response.headers.set(key, value));
  return response;
}

function sessionToken(request: Request): string {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name === SESSION_COOKIE) return part.slice(separator + 1).trim();
  }
  return "";
}

function sessionMaxAgeSeconds(rememberLogin: boolean): number {
  return rememberLogin ? REMEMBERED_SESSION_MAX_AGE_SECONDS : SESSION_MAX_AGE_SECONDS;
}

function sessionTtlMs(rememberLogin: boolean): number {
  return sessionMaxAgeSeconds(rememberLogin) * 1_000;
}

function sessionCookie(
  request: Request,
  token: string,
  maxAgeSeconds = SESSION_MAX_AGE_SECONDS,
): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
    requestIsSecure(request) ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function clearSessionCookie(request: Request): string {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    requestIsSecure(request) ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function requestIsSecure(request: Request): boolean {
  if (!trustProxyHeaders()) return new URL(request.url).protocol === "https:";
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  return forwardedProtocol === "https" || new URL(request.url).protocol === "https:";
}

function trustedForwardedOrigin(request: Request): string | null {
  if (!trustProxyHeaders()) return null;
  const protocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  const host = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if ((protocol !== "http" && protocol !== "https") || !host) return null;
  if (!/^[a-z0-9.:[\]-]+(?::\d{1,5})?$/.test(host)) return null;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return null;
  }
}

function clientRateKey(request: Request): string {
  if (!trustProxyHeaders()) return "local";
  return (
    cleanClientIp(request.headers.get("cf-connecting-ip")) ??
    cleanClientIp(request.headers.get("x-real-ip")) ??
    cleanClientIp(request.headers.get("x-forwarded-for")?.split(",")[0]) ??
    "local"
  );
}

function cleanClientIp(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 64 && isIP(trimmed) > 0 ? trimmed : null;
}

function trustProxyHeaders(): boolean {
  return process.env.COFFER_TRUST_PROXY === "1";
}

function errorResponse(error: unknown): Response {
  if (error instanceof RequestError) {
    return json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  if (error instanceof VaultStoreError) {
    const statusByCode: Record<typeof error.code, number> = {
      already_configured: 409,
      not_configured: 409,
      invalid_credentials: 401,
      rate_limited: 429,
      unauthorized: 401,
      legacy_claim_required: 409,
      legacy_unavailable: 409,
      revision_conflict: 409,
      invalid_input: 400,
      corrupt_store: 500,
    };
    const publicMessage =
      error.code === "corrupt_store"
        ? "The vault storage is unavailable."
        : error.message;
    const details =
      error.code === "revision_conflict" && error.currentRevision
        ? { currentRevision: error.currentRevision }
        : undefined;
    const headers: HeadersInit = {};
    if (error.code === "rate_limited" && error.retryAfterSeconds) {
      headers["Retry-After"] = String(error.retryAfterSeconds);
    }
    return json(
      { error: { code: error.code, message: publicMessage, ...(details ?? {}) } },
      { status: statusByCode[error.code], headers },
    );
  }

  return json(
    { error: { code: "storage_error", message: "The vault storage is unavailable." } },
    { status: 500 },
  );
}

function invalidSchema(): RequestError {
  return new RequestError(400, "invalid_request", "The request shape is invalid.");
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(value: JsonObject, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function hasExactKeysWithOptional(
  value: JsonObject,
  keys: readonly string[],
  optionalKeys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    keys.every((key) => actual.includes(key)) &&
    actual.every((key) => keys.includes(key) || optionalKeys.includes(key))
  );
}

function readRememberLogin(body: JsonObject): boolean {
  if (body.rememberLogin === undefined) return false;
  if (typeof body.rememberLogin !== "boolean") throw invalidSchema();
  return body.rememberLogin;
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, {
    ...init,
    headers: responseHeaders(init.headers),
  });
}

function responseHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}
