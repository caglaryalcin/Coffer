import {
  constants as fsConstants,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import type {
  EncryptedVaultHeader,
  VaultKdfParams,
  VaultPayloadCipher,
  WrappedVaultKey,
} from "../vault-crypto";

export type {
  EncryptedVaultHeader,
  VaultKdfParams,
  VaultPayloadCipher,
  WrappedVaultKey,
} from "../vault-crypto";

export const VAULT_FILE_FORMAT = "coffer-server-vault" as const;
export const VAULT_FILE_VERSION = 1 as const;
export const LEGACY_CLAIM_FORMAT = "coffer-legacy-claim" as const;

const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const DEFAULT_FAILURE_WINDOW_MS = 5 * 60 * 1_000;
const DEFAULT_LOCKOUT_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_IDENTIFY_WINDOW_MS = 60 * 1_000;
const DEFAULT_MAX_IDENTIFY_REQUESTS = 60;
const DEFAULT_SETUP_WINDOW_MS = 60 * 60 * 1_000;
const DEFAULT_MAX_SETUP_REQUESTS = 20;
const MAX_STORED_FILE_BYTES = 24 * 1024 * 1024;
const MAX_ENCRYPTED_PAYLOAD_BYTES = 16 * 1024 * 1024 + 16;
const IDENTIFIER_MAX_LENGTH = 254;
const IDENTIFIER_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const ACCOUNT_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type VaultCryptoHeader = EncryptedVaultHeader;
export type EncryptedVaultPayload = VaultPayloadCipher;

type StoredVaultFile = {
  format: typeof VAULT_FILE_FORMAT;
  version: typeof VAULT_FILE_VERSION;
  revision: number;
  createdAt: string;
  updatedAt: string;
  authVerifier: { algorithm: "SHA-256"; value: string };
  header: VaultCryptoHeader;
  payload: EncryptedVaultPayload;
};

type LegacyClaimMarker = {
  format: typeof LEGACY_CLAIM_FORMAT;
  version: 1;
  status: "pending" | "committed";
  accountKey: string;
  createdAt: string;
  committedAt: string | null;
};

type FailedLoginState = { attempts: number[]; blockedUntil: number };
type VaultSessionPrincipal =
  | { kind: "user"; accountKey: string; vaultId: string }
  | { kind: "legacy"; vaultId: string };
type VaultSession = { principal: VaultSessionPrincipal; expiresAt: number };

export type VaultStoreOptions = {
  dataDir?: string;
  now?: () => number;
  random?: (size: number) => Uint8Array;
  sessionTtlMs?: number;
  failureWindowMs?: number;
  lockoutMs?: number;
  maxFailures?: number;
  identifyWindowMs?: number;
  maxIdentifyRequests?: number;
  setupWindowMs?: number;
  maxSetupRequests?: number;
};

export type SetupVaultInput = {
  identifier: string;
  header: VaultCryptoHeader;
  payload: EncryptedVaultPayload;
  authProof: Uint8Array;
};

export type SaveVaultInput = {
  sessionToken: string;
  vaultId: string;
  expectedRevision: number;
  payload: EncryptedVaultPayload;
};

export type DeleteAccountInput = {
  sessionToken: string;
  vaultId: string;
  authProof: Uint8Array;
  rateKey: string;
};

export type ChangePasswordInput = {
  sessionToken: string;
  vaultId: string;
  expectedRevision: number;
  currentAuthProof: Uint8Array;
  nextAuthProof: Uint8Array;
  header: VaultCryptoHeader;
  rateKey: string;
};

export type IdentifyResult =
  | { configured: false }
  | {
      configured: true;
      revision: number;
      header: VaultCryptoHeader;
      legacy: boolean;
    };

export type AuthenticatedVaultBootstrap =
  | { authenticated: false }
  | {
      authenticated: true;
      revision: number;
      header: VaultCryptoHeader;
      legacy?: true;
    };

export type LoginResult = {
  revision: number;
  payload: EncryptedVaultPayload;
  legacy: boolean;
  sessionToken: string;
  sessionExpiresAt: string;
};
export type SetupResult = {
  revision: number;
  sessionToken: string;
  sessionExpiresAt: string;
};
export type SaveResult = { revision: number; updatedAt: string };
export type ChangePasswordResult = {
  revision: number;
  updatedAt: string;
  sessionToken: string;
  sessionExpiresAt: string;
};
export type ClaimLegacyResult = { claimed: true; revision: number };
export type VaultStoreErrorCode =
  | "already_configured"
  | "not_configured"
  | "invalid_credentials"
  | "rate_limited"
  | "unauthorized"
  | "legacy_claim_required"
  | "legacy_unavailable"
  | "revision_conflict"
  | "invalid_input"
  | "corrupt_store";

export class VaultStoreError extends Error {
  readonly code: VaultStoreErrorCode;
  readonly retryAfterSeconds?: number;
  readonly currentRevision?: number;

  constructor(
    code: VaultStoreErrorCode,
    message: string,
    details: { retryAfterSeconds?: number; currentRevision?: number } = {},
  ) {
    super(message);
    this.name = "VaultStoreError";
    this.code = code;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.currentRevision = details.currentRevision;
  }
}

export class VaultStore {
  readonly dataDir: string;
  /** Unclaimed single-user vault retained for migration compatibility. */
  readonly vaultPath: string;
  readonly usersDir: string;
  readonly legacyBackupPath: string;
  readonly legacyClaimPath: string;

  private readonly now: () => number;
  private readonly random: (size: number) => Uint8Array;
  private readonly sessionTtlMs: number;
  private readonly failureWindowMs: number;
  private readonly lockoutMs: number;
  private readonly maxFailures: number;
  private readonly identifyWindowMs: number;
  private readonly maxIdentifyRequests: number;
  private readonly setupWindowMs: number;
  private readonly maxSetupRequests: number;
  private readonly sessions = new Map<string, VaultSession>();
  private readonly failedLogins = new Map<string, FailedLoginState>();
  private readonly identifyRequests = new Map<string, number[]>();
  private readonly setupRequests = new Map<string, number[]>();
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: VaultStoreOptions = {}) {
    this.dataDir = resolve(options.dataDir ?? process.env.COFFER_DATA_DIR ?? "data");
    this.vaultPath = resolve(this.dataDir, "vault.json");
    this.usersDir = resolve(this.dataDir, "users");
    this.legacyBackupPath = resolve(this.dataDir, "legacy-vault.backup.json");
    this.legacyClaimPath = resolve(this.dataDir, "legacy-claim.json");
    this.now = options.now ?? Date.now;
    this.random = options.random ?? ((size) => randomBytes(size));
    this.sessionTtlMs = options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.failureWindowMs = options.failureWindowMs ?? DEFAULT_FAILURE_WINDOW_MS;
    this.lockoutMs = options.lockoutMs ?? DEFAULT_LOCKOUT_MS;
    this.maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
    this.identifyWindowMs = options.identifyWindowMs ?? DEFAULT_IDENTIFY_WINDOW_MS;
    this.maxIdentifyRequests =
      options.maxIdentifyRequests ?? DEFAULT_MAX_IDENTIFY_REQUESTS;
    this.setupWindowMs = options.setupWindowMs ?? DEFAULT_SETUP_WINDOW_MS;
    this.maxSetupRequests = options.maxSetupRequests ?? DEFAULT_MAX_SETUP_REQUESTS;
  }

  async identify(identifier: string, rateKey: string): Promise<IdentifyResult> {
    this.recordIdentifyRequest(rateKey);
    const accountKey = accountKeyForIdentifier(identifier);
    await this.recoverLegacyClaim();

    const stored = await this.readStoredVault(this.userVaultPath(accountKey));
    if (stored) return publicIdentifyResult(stored, false);
    const legacy = await this.readStoredVault(this.vaultPath);
    if (legacy) return publicIdentifyResult(legacy, true);
    return { configured: false };
  }

  async getAuthenticatedBootstrap(
    sessionToken: string,
  ): Promise<AuthenticatedVaultBootstrap> {
    await this.recoverLegacyClaim();
    const session = this.validSession(sessionToken);
    if (!session) return { authenticated: false };
    const stored = await this.readStoredVault(this.pathForPrincipal(session.principal));
    if (!stored || stored.header.vaultId !== session.principal.vaultId) {
      this.deleteSession(sessionToken);
      return { authenticated: false };
    }
    return {
      authenticated: true,
      revision: stored.revision,
      header: structuredClone(stored.header),
      ...(session.principal.kind === "legacy" ? { legacy: true as const } : {}),
    };
  }

  async setup(input: SetupVaultInput, rateKey = "local"): Promise<SetupResult> {
    this.recordSetupRequest(rateKey);
    const accountKey = accountKeyForIdentifier(input.identifier);
    if (
      input.authProof.byteLength !== 32 ||
      !isVaultCryptoHeader(input.header) ||
      !isEncryptedVaultPayload(input.payload)
    ) {
      throw new VaultStoreError("invalid_input", "The vault data is invalid.");
    }
    await this.recoverLegacyClaim();
    return this.withMutationLock(async () => {
      if (await this.readStoredVault(this.vaultPath)) {
        throw new VaultStoreError(
          "legacy_claim_required",
          "Claim the existing legacy vault before creating another account.",
        );
      }
      const path = this.userVaultPath(accountKey);
      if (await this.readStoredVault(path)) {
        throw new VaultStoreError(
          "already_configured",
          "An account already exists for this identifier.",
        );
      }
      const timestamp = new Date(this.now()).toISOString();
      const stored: StoredVaultFile = {
        format: VAULT_FILE_FORMAT,
        version: VAULT_FILE_VERSION,
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        authVerifier: { algorithm: "SHA-256", value: hashProof(input.authProof) },
        header: structuredClone(input.header),
        payload: structuredClone(input.payload),
      };
      await this.atomicWriteJson(path, stored);
      const session = this.issueSession({
        kind: "user",
        accountKey,
        vaultId: stored.header.vaultId,
      });
      return { revision: stored.revision, ...session };
    });
  }

  async login(
    identifier: string,
    authProof: Uint8Array,
    rateKey: string,
  ): Promise<LoginResult> {
    const accountKey = accountKeyForIdentifier(identifier);
    if (authProof.byteLength !== 32) {
      throw new VaultStoreError("invalid_input", "The vault proof is invalid.");
    }
    await this.recoverLegacyClaim();

    return this.withMutationLock(async () => {
      let stored = await this.readStoredVault(this.userVaultPath(accountKey));
      const legacy = !stored;
      if (legacy) {
        stored = await this.readStoredVault(this.vaultPath);
      }
      const failureKey = legacy && stored
        ? `login:${rateKey}:legacy`
        : `login:${rateKey}:${accountKey}`;
      this.assertLoginAllowed(failureKey);
      if (!stored || !proofMatches(stored, authProof)) {
        const failure = this.recordFailedLogin(failureKey);
        if (failure.blockedUntil > this.now()) {
          throw this.rateLimitError(failure.blockedUntil, this.now());
        }
        throw new VaultStoreError(
          "invalid_credentials",
          "The account identifier or password is incorrect.",
        );
      }
      this.failedLogins.delete(failureKey);
      const principal: VaultSessionPrincipal = legacy
        ? { kind: "legacy", vaultId: stored.header.vaultId }
        : { kind: "user", accountKey, vaultId: stored.header.vaultId };
      const session = this.issueSession(principal);
      return {
        revision: stored.revision,
        payload: structuredClone(stored.payload),
        legacy: principal.kind === "legacy",
        ...session,
      };
    });
  }

  async loginWithSession(
    sessionToken: string,
    authProof: Uint8Array,
    rateKey: string,
  ): Promise<LoginResult> {
    if (authProof.byteLength !== 32) {
      throw new VaultStoreError("invalid_input", "The vault proof is invalid.");
    }
    await this.recoverLegacyClaim();

    return this.withMutationLock(async () => {
      const existingSession = this.validSession(sessionToken);
      if (!existingSession || existingSession.principal.kind !== "user") {
        throw new VaultStoreError(
          "unauthorized",
          "A valid account session is required.",
        );
      }
      const { accountKey } = existingSession.principal;
      const failureKey = `resume:${rateKey}:${accountKey}`;
      this.assertLoginAllowed(failureKey);
      const stored = await this.readStoredVault(this.userVaultPath(accountKey));
      if (!stored || stored.header.vaultId !== existingSession.principal.vaultId) {
        this.deleteSession(sessionToken);
        throw new VaultStoreError(
          "unauthorized",
          "The account session no longer matches this encrypted vault.",
        );
      }
      if (!proofMatches(stored, authProof)) {
        const failure = this.recordFailedLogin(failureKey);
        if (failure.blockedUntil > this.now()) {
          throw this.rateLimitError(failure.blockedUntil, this.now());
        }
        throw new VaultStoreError(
          "invalid_credentials",
          "The account identifier or password is incorrect.",
        );
      }
      this.failedLogins.delete(failureKey);
      this.deleteSession(sessionToken);
      const session = this.issueSession({
        kind: "user",
        accountKey,
        vaultId: stored.header.vaultId,
      });
      return {
        revision: stored.revision,
        payload: structuredClone(stored.payload),
        legacy: false,
        ...session,
      };
    });
  }

  async claimLegacy(
    sessionToken: string,
    identifier: string,
  ): Promise<ClaimLegacyResult> {
    const accountKey = accountKeyForIdentifier(identifier);
    const session = this.validSession(sessionToken);
    if (!session || session.principal.kind !== "legacy") {
      throw new VaultStoreError(
        "unauthorized",
        "A valid legacy vault session is required.",
      );
    }
    return this.withMutationLock(async () => {
      const activeSession = this.validSession(sessionToken);
      if (!activeSession || activeSession.principal.kind !== "legacy") {
        throw new VaultStoreError(
          "unauthorized",
          "A valid legacy vault session is required.",
        );
      }
      const legacyVaultId = activeSession.principal.vaultId;

      let marker = await this.readLegacyClaimMarker();
      if (marker) {
        await this.recoverLegacyClaimLocked(marker);
        marker = await this.readLegacyClaimMarker();
        if (marker?.accountKey !== accountKey) {
          throw new VaultStoreError(
            "legacy_unavailable",
            "The legacy vault has already been claimed.",
          );
        }
        const claimed = await this.readStoredVault(this.userVaultPath(accountKey));
        if (!claimed) {
          throw new VaultStoreError(
            "corrupt_store",
            "The claimed legacy vault is unavailable.",
          );
        }
        if (claimed.header.vaultId !== legacyVaultId) {
          this.deleteSession(sessionToken);
          throw new VaultStoreError(
            "unauthorized",
            "The legacy session no longer matches this encrypted vault.",
          );
        }
        activeSession.principal = {
          kind: "user",
          accountKey,
          vaultId: claimed.header.vaultId,
        };
        return { claimed: true, revision: claimed.revision };
      }

      const destination = this.userVaultPath(accountKey);
      if (await this.readStoredVault(destination)) {
        throw new VaultStoreError(
          "already_configured",
          "An account already exists for this identifier.",
        );
      }
      const legacy = await this.readStoredVault(this.vaultPath);
      if (!legacy) {
        throw new VaultStoreError(
          "legacy_unavailable",
          "The legacy vault is no longer available.",
        );
      }
      if (legacy.header.vaultId !== legacyVaultId) {
        this.deleteSession(sessionToken);
        throw new VaultStoreError(
          "unauthorized",
          "The legacy session no longer matches this encrypted vault.",
        );
      }

      await this.ensureLegacyBackup(legacy);
      const createdAt = new Date(this.now()).toISOString();
      const pending: LegacyClaimMarker = {
        format: LEGACY_CLAIM_FORMAT,
        version: 1,
        status: "pending",
        accountKey,
        createdAt,
        committedAt: null,
      };
      await this.atomicWriteJson(this.legacyClaimPath, pending);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await chmod(dirname(destination), 0o700).catch(() => undefined);
      await rename(this.vaultPath, destination);
      await chmod(destination, 0o600).catch(() => undefined);
      await syncDirectoryBestEffort(dirname(destination));
      await syncDirectoryBestEffort(this.dataDir);

      await this.atomicWriteJson(this.legacyClaimPath, {
        ...pending,
        status: "committed",
        committedAt: new Date(this.now()).toISOString(),
      } satisfies LegacyClaimMarker);
      activeSession.principal = {
        kind: "user",
        accountKey,
        vaultId: legacy.header.vaultId,
      };
      return { claimed: true, revision: legacy.revision };
    });
  }

  async save(input: SaveVaultInput): Promise<SaveResult> {
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      !isCanonicalEncodedBytes(input.vaultId, 16) ||
      !isEncryptedVaultPayload(input.payload)
    ) {
      throw new VaultStoreError("invalid_input", "The vault data is invalid.");
    }
    this.requireUserSession(input.sessionToken);
    return this.withMutationLock(async () => {
      const activeSession = this.requireUserSession(input.sessionToken);
      if (activeSession.principal.kind !== "user") {
        throw new VaultStoreError(
          "legacy_claim_required",
          "Claim the legacy vault before saving changes.",
        );
      }
      const path = this.userVaultPath(activeSession.principal.accountKey);
      const stored = await this.readStoredVault(path);
      if (!stored) {
        throw new VaultStoreError(
          "not_configured",
          "No vault has been configured for this account.",
        );
      }
      if (stored.header.vaultId !== activeSession.principal.vaultId) {
        this.deleteSession(input.sessionToken);
        throw new VaultStoreError(
          "unauthorized",
          "The account session no longer matches this encrypted vault.",
        );
      }
      if (stored.header.vaultId !== input.vaultId) {
        throw new VaultStoreError(
          "unauthorized",
          "The vault session does not match this encrypted vault.",
        );
      }
      if (stored.revision !== input.expectedRevision) {
        throw new VaultStoreError(
          "revision_conflict",
          "The vault changed since it was loaded.",
          { currentRevision: stored.revision },
        );
      }
      const updatedAt = new Date(this.now()).toISOString();
      const next: StoredVaultFile = {
        ...stored,
        revision: stored.revision + 1,
        updatedAt,
        payload: structuredClone(input.payload),
      };
      await this.atomicWriteJson(path, next);
      return { revision: next.revision, updatedAt };
    });
  }

  async changePassword(input: ChangePasswordInput): Promise<ChangePasswordResult> {
    if (
      input.currentAuthProof.byteLength !== 32 ||
      input.nextAuthProof.byteLength !== 32 ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      input.expectedRevision >= Number.MAX_SAFE_INTEGER ||
      !isCanonicalEncodedBytes(input.vaultId, 16) ||
      !isVaultCryptoHeader(input.header)
    ) {
      throw new VaultStoreError("invalid_input", "The password change data is invalid.");
    }
    this.requireUserSession(input.sessionToken);

    return this.withMutationLock(async () => {
      const activeSession = this.requireUserSession(input.sessionToken);
      if (activeSession.principal.kind !== "user") {
        throw new VaultStoreError(
          "legacy_claim_required",
          "Claim the legacy vault before changing its password.",
        );
      }

      const { accountKey } = activeSession.principal;
      const path = this.userVaultPath(accountKey);
      const stored = await this.readStoredVault(path);
      if (!stored) {
        throw new VaultStoreError(
          "not_configured",
          "No vault has been configured for this account.",
        );
      }
      if (stored.header.vaultId !== activeSession.principal.vaultId) {
        this.deleteSession(input.sessionToken);
        throw new VaultStoreError(
          "unauthorized",
          "The account session no longer matches this encrypted vault.",
        );
      }
      if (stored.header.vaultId !== input.vaultId) {
        throw new VaultStoreError(
          "unauthorized",
          "The vault session does not match this encrypted vault.",
        );
      }
      if (
        input.header.vaultId !== stored.header.vaultId ||
        input.header.createdAt !== stored.header.createdAt
      ) {
        throw new VaultStoreError(
          "invalid_input",
          "The replacement vault header does not match this encrypted vault.",
        );
      }

      const exactRetry =
        stored.revision === input.expectedRevision + 1 &&
        vaultHeadersEqual(stored.header, input.header) &&
        proofMatches(stored, input.nextAuthProof);
      if (exactRetry) {
        this.revokeAccountSessions(accountKey);
        const session = this.issueSession({
          kind: "user",
          accountKey,
          vaultId: stored.header.vaultId,
        });
        this.clearFailedLoginsForAccount(accountKey);
        return {
          revision: stored.revision,
          updatedAt: stored.updatedAt,
          ...session,
        };
      }

      if (stored.revision !== input.expectedRevision) {
        throw new VaultStoreError(
          "revision_conflict",
          "The vault changed since it was loaded.",
          { currentRevision: stored.revision },
        );
      }

      const failureKey = `password-change:${input.rateKey.slice(0, 256)}:${accountKey}`;
      this.assertLoginAllowed(failureKey);
      if (!proofMatches(stored, input.currentAuthProof)) {
        const failure = this.recordFailedLogin(failureKey);
        if (failure.blockedUntil > this.now()) {
          throw this.rateLimitError(failure.blockedUntil, this.now());
        }
        throw new VaultStoreError(
          "invalid_credentials",
          "The current password is incorrect.",
        );
      }
      if (
        proofMatches(stored, input.nextAuthProof) ||
        input.header.kdf.salt === stored.header.kdf.salt ||
        input.header.passwordVerifier.value === stored.header.passwordVerifier.value ||
        input.header.wrappedKey.iv === stored.header.wrappedKey.iv
      ) {
        throw new VaultStoreError(
          "invalid_input",
          "The replacement vault credentials must use fresh key material.",
        );
      }

      const updatedAt = new Date(this.now()).toISOString();
      const next: StoredVaultFile = {
        ...stored,
        revision: stored.revision + 1,
        updatedAt,
        authVerifier: { algorithm: "SHA-256", value: hashProof(input.nextAuthProof) },
        header: structuredClone(input.header),
      };
      await this.atomicWriteJson(path, next);
      this.revokeAccountSessions(accountKey);
      const session = this.issueSession({
        kind: "user",
        accountKey,
        vaultId: next.header.vaultId,
      });
      this.clearFailedLoginsForAccount(accountKey);
      return { revision: next.revision, updatedAt, ...session };
    });
  }

  async deleteAccount(input: DeleteAccountInput): Promise<void> {
    if (
      input.authProof.byteLength !== 32 ||
      !isCanonicalEncodedBytes(input.vaultId, 16)
    ) {
      throw new VaultStoreError("invalid_input", "The account proof is invalid.");
    }
    await this.recoverLegacyClaim();
    this.requireUserSession(input.sessionToken);

    await this.withMutationLock(async () => {
      const activeSession = this.requireUserSession(input.sessionToken);
      if (activeSession.principal.kind !== "user") {
        throw new VaultStoreError(
          "unauthorized",
          "The account could not be authorized for deletion.",
        );
      }
      const { accountKey } = activeSession.principal;
      const failureKey = `delete:${input.rateKey.slice(0, 256)}:${accountKey}`;
      this.assertLoginAllowed(failureKey);

      const path = this.userVaultPath(accountKey);
      const stored = await this.readStoredVault(path);
      if (!stored) {
        this.revokeAccountSessions(accountKey);
        throw new VaultStoreError(
          "unauthorized",
          "The account could not be authorized for deletion.",
        );
      }
      if (stored.header.vaultId !== activeSession.principal.vaultId) {
        this.deleteSession(input.sessionToken);
        throw new VaultStoreError(
          "unauthorized",
          "The account session no longer matches this encrypted vault.",
        );
      }
      if (stored.header.vaultId !== input.vaultId) {
        throw new VaultStoreError(
          "unauthorized",
          "The account could not be authorized for deletion.",
        );
      }
      if (!proofMatches(stored, input.authProof)) {
        const failure = this.recordFailedLogin(failureKey);
        if (failure.blockedUntil > this.now()) {
          throw this.rateLimitError(failure.blockedUntil, this.now());
        }
        throw new VaultStoreError(
          "invalid_credentials",
          "The account password is incorrect.",
        );
      }

      await this.removeLegacyArtifactsForAccount(accountKey, stored);
      await unlink(path).catch((error: unknown) => {
        if (!isNodeError(error, "ENOENT")) throw error;
      });
      await syncDirectoryBestEffort(dirname(path));
      this.revokeAccountSessions(accountKey);
      this.clearFailedLoginsForAccount(accountKey);
    });
  }

  hasValidSession(sessionToken: string): boolean {
    return Boolean(this.validSession(sessionToken));
  }

  logout(sessionToken: string): void {
    this.deleteSession(sessionToken);
  }

  accountKey(identifier: string): string {
    return accountKeyForIdentifier(identifier);
  }

  accountVaultPath(identifier: string): string {
    return this.userVaultPath(accountKeyForIdentifier(identifier));
  }

  private requireUserSession(sessionToken: string): VaultSession {
    const session = this.validSession(sessionToken);
    if (!session) {
      throw new VaultStoreError("unauthorized", "A valid account session is required.");
    }
    if (session.principal.kind === "legacy") {
      throw new VaultStoreError(
        "legacy_claim_required",
        "Claim the legacy vault before saving changes.",
      );
    }
    return session;
  }

  private validSession(sessionToken: string): VaultSession | null {
    if (!isCanonicalBase64Url(sessionToken, 32)) return null;
    const sessionHash = hashSessionToken(sessionToken);
    const session = this.sessions.get(sessionHash);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(sessionHash);
      return null;
    }
    return session;
  }

  private deleteSession(sessionToken: string): void {
    if (!isCanonicalBase64Url(sessionToken, 32)) return;
    this.sessions.delete(hashSessionToken(sessionToken));
  }

  private revokeAccountSessions(accountKey: string): void {
    for (const [tokenHash, session] of this.sessions) {
      if (
        session.principal.kind === "user" &&
        session.principal.accountKey === accountKey
      ) {
        this.sessions.delete(tokenHash);
      }
    }
  }

  private issueSession(principal: VaultSessionPrincipal): {
    sessionToken: string;
    sessionExpiresAt: string;
  } {
    this.pruneExpiredSessions();
    const sessionToken = Buffer.from(this.random(32)).toString("base64url");
    const expiresAt = this.now() + this.sessionTtlMs;
    this.sessions.set(hashSessionToken(sessionToken), {
      principal: structuredClone(principal),
      expiresAt,
    });
    return {
      sessionToken,
      sessionExpiresAt: new Date(expiresAt).toISOString(),
    };
  }

  private pruneExpiredSessions(): void {
    const now = this.now();
    for (const [tokenHash, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(tokenHash);
    }
  }

  private assertLoginAllowed(failureKey: string): void {
    const now = this.now();
    const rateState = this.activeFailureState(failureKey, now);
    if (rateState.blockedUntil > now) {
      throw this.rateLimitError(rateState.blockedUntil, now);
    }
  }

  private activeFailureState(rateKey: string, now: number): FailedLoginState {
    const existing = this.failedLogins.get(rateKey);
    if (!existing) return { attempts: [], blockedUntil: 0 };
    existing.attempts = existing.attempts.filter(
      (attempt) => attempt > now - this.failureWindowMs,
    );
    if (existing.blockedUntil <= now && existing.attempts.length === 0) {
      this.failedLogins.delete(rateKey);
      return { attempts: [], blockedUntil: 0 };
    }
    return existing;
  }

  private recordFailedLogin(rateKey: string): FailedLoginState {
    const now = this.now();
    const state = this.activeFailureState(rateKey, now);
    state.attempts.push(now);
    if (state.attempts.length >= this.maxFailures) {
      state.blockedUntil = now + this.lockoutMs;
    }
    this.failedLogins.set(rateKey, state);
    this.pruneBoundedMap(this.failedLogins, rateKey, 1_024);
    return state;
  }

  private clearFailedLoginsForAccount(accountKey: string): void {
    const accountSuffix = `:${accountKey}`;
    for (const failureKey of this.failedLogins.keys()) {
      if (failureKey.endsWith(accountSuffix)) {
        this.failedLogins.delete(failureKey);
      }
    }
  }

  private recordIdentifyRequest(rateKey: string): void {
    const safeRateKey = rateKey.slice(0, 256);
    const now = this.now();
    const recent = (this.identifyRequests.get(safeRateKey) ?? []).filter(
      (requestAt) => requestAt > now - this.identifyWindowMs,
    );
    if (recent.length >= this.maxIdentifyRequests) {
      const retryAt = recent[0] + this.identifyWindowMs;
      throw this.rateLimitError(retryAt, now);
    }
    recent.push(now);
    this.identifyRequests.set(safeRateKey, recent);
    this.pruneBoundedMap(this.identifyRequests, safeRateKey, 1_024);
  }

  private recordSetupRequest(rateKey: string): void {
    const safeRateKey = rateKey.slice(0, 256);
    const now = this.now();
    const recent = (this.setupRequests.get(safeRateKey) ?? []).filter(
      (requestAt) => requestAt > now - this.setupWindowMs,
    );
    if (recent.length >= this.maxSetupRequests) {
      const retryAt = recent[0] + this.setupWindowMs;
      throw this.rateLimitError(retryAt, now);
    }
    recent.push(now);
    this.setupRequests.set(safeRateKey, recent);
    this.pruneBoundedMap(this.setupRequests, safeRateKey, 1_024);
  }

  private pruneBoundedMap<T>(map: Map<string, T>, activeKey: string, maximum: number): void {
    if (map.size <= maximum) return;
    const oldestKey = map.keys().next().value as string | undefined;
    if (oldestKey && oldestKey !== activeKey) map.delete(oldestKey);
  }

  private rateLimitError(blockedUntil: number, now: number): VaultStoreError {
    return new VaultStoreError(
      "rate_limited",
      "Too many attempts. Try again later.",
      { retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1_000)) },
    );
  }

  private userVaultPath(accountKey: string): string {
    if (!ACCOUNT_KEY_PATTERN.test(accountKey)) {
      throw new VaultStoreError("invalid_input", "The account identifier is invalid.");
    }
    return resolve(this.usersDir, accountKey.slice(0, 2), `${accountKey}.json`);
  }

  private pathForPrincipal(principal: VaultSessionPrincipal): string {
    return principal.kind === "legacy"
      ? this.vaultPath
      : this.userVaultPath(principal.accountKey);
  }

  private async readStoredVault(path: string): Promise<StoredVaultFile | null> {
    let size: number;
    try {
      size = (await stat(path)).size;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
    if (size > MAX_STORED_FILE_BYTES) {
      throw new VaultStoreError("corrupt_store", "The vault file is too large.");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw new VaultStoreError(
        "corrupt_store",
        "The vault file could not be read.",
      );
    }
    if (!isStoredVaultFile(parsed)) {
      throw new VaultStoreError(
        "corrupt_store",
        "The vault file has an unsupported format.",
      );
    }
    return parsed;
  }

  private async ensureLegacyBackup(legacy: StoredVaultFile): Promise<void> {
    const existing = await this.readStoredVault(this.legacyBackupPath);
    if (existing) {
      if (!storedVaultsEqual(existing, legacy)) {
        throw new VaultStoreError(
          "corrupt_store",
          "The legacy vault backup does not match the vault being claimed.",
        );
      }
      return;
    }
    await this.atomicWriteJson(this.legacyBackupPath, legacy);
  }

  private async removeLegacyArtifactsForAccount(
    accountKey: string,
    stored: StoredVaultFile,
  ): Promise<void> {
    const marker = await this.readLegacyClaimMarker();
    if (!marker || marker.accountKey !== accountKey) return;

    const backup = await this.readStoredVault(this.legacyBackupPath);
    if (backup && !storedVaultAccountsEqual(backup, stored)) {
      throw new VaultStoreError(
        "corrupt_store",
        "The legacy vault backup does not match this account.",
      );
    }

    await unlink(this.legacyBackupPath).catch((error: unknown) => {
      if (!isNodeError(error, "ENOENT")) throw error;
    });
    await unlink(this.legacyClaimPath).catch((error: unknown) => {
      if (!isNodeError(error, "ENOENT")) throw error;
    });
    await syncDirectoryBestEffort(this.dataDir);
  }

  private async recoverLegacyClaim(): Promise<void> {
    await this.withMutationLock(async () => {
      const marker = await this.readLegacyClaimMarker();
      if (marker?.status === "pending") {
        await this.recoverLegacyClaimLocked(marker);
      }
    });
  }

  private async recoverLegacyClaimLocked(marker: LegacyClaimMarker): Promise<void> {
    if (marker.status === "committed") return;
    const destination = this.userVaultPath(marker.accountKey);
    const legacy = await this.readStoredVault(this.vaultPath);
    const claimed = await this.readStoredVault(destination);
    if (legacy && claimed) {
      throw new VaultStoreError(
        "corrupt_store",
        "The interrupted legacy vault claim is ambiguous.",
      );
    }
    if (!legacy && !claimed) {
      throw new VaultStoreError(
        "corrupt_store",
        "The interrupted legacy vault claim lost both encrypted copies.",
      );
    }
    await this.ensureLegacyBackup(legacy ?? claimed as StoredVaultFile);
    if (legacy) {
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await chmod(dirname(destination), 0o700).catch(() => undefined);
      await rename(this.vaultPath, destination);
      await chmod(destination, 0o600).catch(() => undefined);
      await syncDirectoryBestEffort(dirname(destination));
      await syncDirectoryBestEffort(this.dataDir);
    }
    await this.atomicWriteJson(this.legacyClaimPath, {
      ...marker,
      status: "committed",
      committedAt: new Date(this.now()).toISOString(),
    } satisfies LegacyClaimMarker);
  }

  private async readLegacyClaimMarker(): Promise<LegacyClaimMarker | null> {
    let parsed: unknown;
    try {
      const file = await readFile(this.legacyClaimPath, "utf8");
      if (file.length > 4_096) throw new Error("Marker too large");
      parsed = JSON.parse(file);
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw new VaultStoreError(
        "corrupt_store",
        "The legacy vault claim marker could not be read.",
      );
    }
    if (!isLegacyClaimMarker(parsed)) {
      throw new VaultStoreError(
        "corrupt_store",
        "The legacy vault claim marker is invalid.",
      );
    }
    return parsed;
  }

  private async atomicWriteJson(path: string, value: unknown): Promise<void> {
    const targetDirectory = dirname(path);
    await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
    await chmod(targetDirectory, 0o700).catch(() => undefined);
    const tempPath = resolve(
      targetDirectory,
      `.coffer-${Buffer.from(this.random(12)).toString("hex")}.tmp`,
    );
    const serialized = `${JSON.stringify(value)}\n`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        tempPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
        0o600,
      );
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(tempPath, path);
      await chmod(path, 0o600).catch(() => undefined);
      await syncDirectoryBestEffort(targetDirectory);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release: () => void = () => {};
    this.mutationQueue = new Promise<void>((resolveQueue) => {
      release = resolveQueue;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export function normalizeVaultIdentifier(value: unknown): string {
  if (typeof value !== "string") {
    throw new VaultStoreError("invalid_input", "The account identifier is invalid.");
  }
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (
    normalized.length < 3 ||
    normalized.length > IDENTIFIER_MAX_LENGTH ||
    !IDENTIFIER_PATTERN.test(normalized) ||
    [...normalized].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new VaultStoreError("invalid_input", "The account identifier is invalid.");
  }
  return normalized;
}

export function accountKeyForIdentifier(identifier: string): string {
  return createHash("sha256")
    .update(normalizeVaultIdentifier(identifier), "utf8")
    .digest("base64url");
}

function publicIdentifyResult(
  stored: StoredVaultFile,
  legacy: boolean,
): Extract<IdentifyResult, { configured: true }> {
  return {
    configured: true,
    revision: stored.revision,
    header: structuredClone(stored.header),
    legacy,
  };
}

function proofMatches(stored: StoredVaultFile, authProof: Uint8Array): boolean {
  const candidate = Buffer.from(hashProof(authProof), "base64url");
  const expected = Buffer.from(stored.authVerifier.value, "base64url");
  return candidate.byteLength === expected.byteLength && timingSafeEqual(candidate, expected);
}

function vaultHeadersEqual(left: VaultCryptoHeader, right: VaultCryptoHeader): boolean {
  return (
    left.format === right.format &&
    left.version === right.version &&
    left.vaultId === right.vaultId &&
    left.createdAt === right.createdAt &&
    left.kdf.algorithm === right.kdf.algorithm &&
    left.kdf.salt === right.kdf.salt &&
    left.kdf.memoryKiB === right.kdf.memoryKiB &&
    left.kdf.iterations === right.kdf.iterations &&
    left.kdf.parallelism === right.kdf.parallelism &&
    left.kdf.hashLength === right.kdf.hashLength &&
    left.passwordVerifier.algorithm === right.passwordVerifier.algorithm &&
    left.passwordVerifier.value === right.passwordVerifier.value &&
    left.wrappedKey.algorithm === right.wrappedKey.algorithm &&
    left.wrappedKey.iv === right.wrappedKey.iv &&
    left.wrappedKey.ciphertext === right.wrappedKey.ciphertext &&
    left.wrappedKey.tagLength === right.wrappedKey.tagLength
  );
}

function storedVaultsEqual(first: StoredVaultFile, second: StoredVaultFile): boolean {
  const firstHash = createHash("sha256").update(JSON.stringify(first)).digest();
  const secondHash = createHash("sha256").update(JSON.stringify(second)).digest();
  return firstHash.byteLength === secondHash.byteLength && timingSafeEqual(firstHash, secondHash);
}

function storedVaultAccountsEqual(
  first: StoredVaultFile,
  second: StoredVaultFile,
): boolean {
  const accountIdentity = (stored: StoredVaultFile) => JSON.stringify({
    createdAt: stored.createdAt,
    vaultId: stored.header.vaultId,
    vaultCreatedAt: stored.header.createdAt,
  });
  const firstHash = createHash("sha256").update(accountIdentity(first)).digest();
  const secondHash = createHash("sha256").update(accountIdentity(second)).digest();
  return timingSafeEqual(firstHash, secondHash);
}

function hashProof(authProof: Uint8Array): string {
  return createHash("sha256").update(authProof).digest("base64url");
}

function hashSessionToken(sessionToken: string): string {
  return createHash("sha256").update(sessionToken, "utf8").digest("base64url");
}

function isStoredVaultFile(value: unknown): value is StoredVaultFile {
  if (!isExactObject(value, [
    "format",
    "version",
    "revision",
    "createdAt",
    "updatedAt",
    "authVerifier",
    "header",
    "payload",
  ])) return false;
  return (
    value.format === VAULT_FILE_FORMAT &&
    value.version === VAULT_FILE_VERSION &&
    isSafeRevision(value.revision) &&
    isIsoTimestamp(value.createdAt) &&
    isIsoTimestamp(value.updatedAt) &&
    isSha256Verifier(value.authVerifier) &&
    isVaultCryptoHeader(value.header) &&
    isEncryptedVaultPayload(value.payload)
  );
}

function isLegacyClaimMarker(value: unknown): value is LegacyClaimMarker {
  if (!isExactObject(value, [
    "format",
    "version",
    "status",
    "accountKey",
    "createdAt",
    "committedAt",
  ])) return false;
  return (
    value.format === LEGACY_CLAIM_FORMAT &&
    value.version === 1 &&
    (value.status === "pending" || value.status === "committed") &&
    typeof value.accountKey === "string" &&
    ACCOUNT_KEY_PATTERN.test(value.accountKey) &&
    isIsoTimestamp(value.createdAt) &&
    (value.status === "pending"
      ? value.committedAt === null
      : isIsoTimestamp(value.committedAt))
  );
}

export function isVaultCryptoHeader(value: unknown): value is VaultCryptoHeader {
  if (!isExactObject(value, [
    "format",
    "version",
    "vaultId",
    "createdAt",
    "kdf",
    "passwordVerifier",
    "wrappedKey",
  ])) return false;
  return (
    value.format === "coffer-vault" &&
    value.version === 1 &&
    isCanonicalEncodedBytes(value.vaultId, 16) &&
    isIsoTimestamp(value.createdAt) &&
    isArgon2idHeader(value.kdf) &&
    isPasswordVerifier(value.passwordVerifier) &&
    isAesGcmCipher(value.wrappedKey, 48, 48)
  );
}

export function isEncryptedVaultPayload(
  value: unknown,
): value is EncryptedVaultPayload {
  return isAesGcmCipher(value, 16, MAX_ENCRYPTED_PAYLOAD_BYTES);
}

function isArgon2idHeader(value: unknown): value is VaultKdfParams {
  return (
    isExactObject(value, [
      "algorithm",
      "salt",
      "memoryKiB",
      "iterations",
      "parallelism",
      "hashLength",
    ]) &&
    value.algorithm === "argon2id" &&
    isCanonicalEncodedBytes(value.salt, 16) &&
    isIntegerInRange(value.memoryKiB, 19_456, 262_144) &&
    isIntegerInRange(value.iterations, 2, 10) &&
    isIntegerInRange(value.parallelism, 1, 4) &&
    value.hashLength === 64
  );
}

function isPasswordVerifier(value: unknown): boolean {
  return (
    isExactObject(value, ["algorithm", "value"]) &&
    value.algorithm === "HMAC-SHA-256" &&
    isCanonicalEncodedBytes(value.value, 32)
  );
}

function isSha256Verifier(value: unknown): boolean {
  return (
    isExactObject(value, ["algorithm", "value"]) &&
    value.algorithm === "SHA-256" &&
    typeof value.value === "string" &&
    isCanonicalBase64Url(value.value, 32)
  );
}

function isAesGcmCipher(
  value: unknown,
  minimumCiphertextBytes: number,
  maximumCiphertextBytes: number,
): value is WrappedVaultKey {
  return (
    isExactObject(value, ["algorithm", "iv", "ciphertext", "tagLength"]) &&
    value.algorithm === "AES-256-GCM" &&
    isCanonicalEncodedBytes(value.iv, 12) &&
    isCanonicalEncodedBytesInRange(
      value.ciphertext,
      minimumCiphertextBytes,
      maximumCiphertextBytes,
    ) &&
    value.tagLength === 128
  );
}

export function decodeFixedAuthProof(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !isCanonicalBase64Url(value, 32)) return null;
  return Buffer.from(value, "base64url");
}

function decodeCanonicalBytes(value: string): Uint8Array | null {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) return null;
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.toString("base64") === value ? bytes : null;
  } catch {
    return null;
  }
}

function isCanonicalEncodedBytes(value: unknown, byteLength: number): boolean {
  return typeof value === "string" && decodeCanonicalBytes(value)?.byteLength === byteLength;
}

function isCanonicalEncodedBytesInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): boolean {
  if (typeof value !== "string") return false;
  const decoded = decodeCanonicalBytes(value);
  return Boolean(decoded && decoded.byteLength >= minimum && decoded.byteLength <= maximum);
}

function isCanonicalBase64Url(value: string, byteLength: number): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength === byteLength && decoded.toString("base64url") === value;
}

function isExactObject(
  value: unknown,
  allowedKeys: readonly string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowedKeys.length && keys.every((key) => allowedKeys.includes(key));
}

function isIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isSafeRevision(value: unknown): value is number {
  return isIntegerInRange(value, 1, Number.MAX_SAFE_INTEGER);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20 || value.length > 35) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

async function syncDirectoryBestEffort(dataDir: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(dataDir, fsConstants.O_RDONLY);
    await handle.sync();
  } catch {
    // Some platforms do not support syncing a directory handle.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
