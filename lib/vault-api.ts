import type { EncryptedVaultHeader, VaultPayloadCipher } from "./vault-crypto";

export const VAULT_API_TIMEOUT_MS = 10_000;

export type VaultBootstrap =
  | { authenticated: false }
  | {
      authenticated: true;
      revision: number;
      header: EncryptedVaultHeader;
      legacy: boolean;
    };

export type VaultIdentity =
  | { configured: false }
  | {
      configured: true;
      revision: number;
      header: EncryptedVaultHeader;
      legacy: boolean;
    };

export type VaultLoginResult = {
  revision: number;
  payload: VaultPayloadCipher;
  legacy: boolean;
};

export type VaultSaveResult = { revision: number; updatedAt: string };
export type VaultChangePasswordResult = { revision: number; updatedAt: string };
export type LegacyClaimResult = { claimed: true; revision: number };

export class VaultApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly currentRevision?: number,
  ) {
    super(message);
    this.name = "VaultApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new VaultApiError(
      "The vault server returned an unreadable response.",
      "invalid_response",
      response.status,
    );
  }
  if (!response.ok) {
    const error = isRecord(body) && isRecord(body.error) ? body.error : null;
    const message = error && typeof error.message === "string"
      ? error.message
      : "The vault request failed.";
    const code = error && typeof error.code === "string"
      ? error.code
      : "request_failed";
    const currentRevision = error && isRevision(error.currentRevision)
      ? error.currentRevision
      : undefined;
    throw new VaultApiError(message, code, response.status, currentRevision);
  }
  return body;
}

async function requestVault(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<{ body: unknown; status: number }> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), VAULT_API_TIMEOUT_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const body = await parseResponse(response);
    return { body, status: response.status };
  } catch (error) {
    if (error instanceof VaultApiError) throw error;
    if (controller.signal.aborted) {
      throw new VaultApiError(
        "The vault server did not respond in time.",
        "request_timeout",
        0,
      );
    }
    throw new VaultApiError(
      "Coffer could not reach the vault server.",
      "network_error",
      0,
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function postVault(
  body: Record<string, unknown>,
): Promise<{ body: unknown; status: number }> {
  return requestVault("/api/vault", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function invalidResponse(message: string, status: number): never {
  throw new VaultApiError(message, "invalid_response", status);
}

function parseHeader(value: unknown): EncryptedVaultHeader | null {
  return isRecord(value) ? value as unknown as EncryptedVaultHeader : null;
}

export async function getVaultBootstrap(): Promise<VaultBootstrap> {
  const { body, status } = await requestVault("/api/vault", {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!isRecord(body) || typeof body.authenticated !== "boolean") {
    invalidResponse("The vault server returned invalid session data.", status);
  }
  if (!body.authenticated) return { authenticated: false };

  const header = parseHeader(body.header);
  if (!isRevision(body.revision) || !header) {
    invalidResponse("The vault server returned invalid session data.", status);
  }
  if (body.legacy !== undefined && body.legacy !== true) {
    invalidResponse("The vault server returned invalid session data.", status);
  }
  return {
    authenticated: true,
    revision: body.revision,
    header,
    legacy: body.legacy === true,
  };
}

export async function identifyVault(identifier: string): Promise<VaultIdentity> {
  const { body, status } = await postVault({ action: "identify", identifier });
  if (!isRecord(body) || typeof body.configured !== "boolean") {
    invalidResponse("The vault server returned invalid account data.", status);
  }
  if (!body.configured) return { configured: false };

  const header = parseHeader(body.header);
  if (!isRevision(body.revision) || !header || typeof body.legacy !== "boolean") {
    invalidResponse("The vault server returned invalid account data.", status);
  }
  return {
    configured: true,
    revision: body.revision,
    header,
    legacy: body.legacy,
  };
}

export async function setupVault(input: {
  identifier: string;
  authProof: string;
  header: EncryptedVaultHeader;
  payload: VaultPayloadCipher;
}): Promise<{ revision: number }> {
  const { body, status } = await postVault({ action: "setup", ...input });
  if (!isRecord(body) || body.configured !== true || !isRevision(body.revision)) {
    invalidResponse("The vault server returned an invalid account result.", status);
  }
  return { revision: body.revision };
}

/**
 * Fresh sign-in includes the email identifier. Session resume omits it and
 * relies on the valid same-origin HttpOnly cookie to select the account.
 */
export async function loginVault(
  authProof: string,
  identifier?: string,
): Promise<VaultLoginResult> {
  const request = identifier === undefined
    ? { action: "login", authProof }
    : { action: "login", identifier, authProof };
  const { body, status } = await postVault(request);
  if (
    !isRecord(body) ||
    !isRevision(body.revision) ||
    !isRecord(body.payload) ||
    typeof body.legacy !== "boolean"
  ) {
    invalidResponse("The vault server returned an invalid sign-in result.", status);
  }
  return {
    revision: body.revision,
    payload: body.payload as unknown as VaultPayloadCipher,
    legacy: body.legacy,
  };
}

export async function claimLegacyVault(identifier: string): Promise<LegacyClaimResult> {
  const { body, status } = await postVault({ action: "claim_legacy", identifier });
  if (!isRecord(body) || body.claimed !== true || !isRevision(body.revision)) {
    invalidResponse("The vault server returned an invalid migration result.", status);
  }
  return { claimed: true, revision: body.revision };
}

export async function saveVault(
  vaultId: string,
  expectedRevision: number,
  payload: VaultPayloadCipher,
): Promise<VaultSaveResult> {
  const { body, status } = await postVault({ action: "save", vaultId, expectedRevision, payload });
  if (
    !isRecord(body) ||
    !isRevision(body.revision) ||
    typeof body.updatedAt !== "string"
  ) {
    invalidResponse("The vault server returned an invalid save result.", status);
  }
  return { revision: body.revision, updatedAt: body.updatedAt };
}

export async function changeVaultPassword(input: {
  vaultId: string;
  expectedRevision: number;
  currentAuthProof: string;
  nextAuthProof: string;
  header: EncryptedVaultHeader;
}): Promise<VaultChangePasswordResult> {
  const { body, status } = await postVault({ action: "change_password", ...input });
  if (
    !isRecord(body) ||
    !isRevision(body.revision) ||
    typeof body.updatedAt !== "string"
  ) {
    invalidResponse("The vault server returned an invalid password change result.", status);
  }
  return { revision: body.revision, updatedAt: body.updatedAt };
}

export async function deleteVaultAccount(
  vaultId: string,
  authProof: string,
): Promise<void> {
  const { body, status } = await postVault({
    action: "delete_account",
    vaultId,
    authProof,
  });
  if (status !== 204 || body !== null) {
    invalidResponse("The vault server returned an invalid account deletion result.", status);
  }
}

export async function logoutVault(): Promise<void> {
  const { body, status } = await postVault({ action: "logout" });
  if (status !== 204 || body !== null) {
    invalidResponse("The vault server returned an invalid sign-out result.", status);
  }
}
