import {
  DEFAULT_VAULT_RESUME_AGE_MS,
  getVaultResumeSealingMaterial,
  isVaultResumeKeyEnvelope,
  MAX_VAULT_RESUME_AGE_MS,
  restoreVaultRuntimeFromResumeEnvelope,
  type VaultResumeKeyEnvelope,
  type VaultResumeSealingMaterial,
  type VaultRuntime,
} from "./vault-crypto";

const DATABASE_NAME = "coffer-vault-resume";
// Version 2 deliberately clears the v1 store, whose records could contain
// directly usable structured-cloned CryptoKeys from pre-release builds.
const DATABASE_VERSION = 2;
const STORE_NAME = "runtime-sessions";
const SESSION_CAPABILITY_KEY = "coffer:vault-resume:capability:v2";
const REMEMBERED_CAPABILITY_KEY = "coffer:vault-resume:remembered-capability:v1";
const REMEMBERED_HINT_KEY = "coffer:vault-resume:remembered-hint:v1";
const LEGACY_SESSION_TOKEN_KEY = "coffer:vault-resume:tab-token:v1";
const OPERATION_TIMEOUT_MS = 5_000;
const MAX_SWEEP_RECORDS = 128;
const TAB_TOKEN_BYTES = 32;
const WRAPPING_SECRET_BYTES = 32;
const VAULT_ID_BYTES = 16;

export type VaultResumePersistence = "session" | "remembered";

export const DEFAULT_VAULT_RESUME_TTL_MS = DEFAULT_VAULT_RESUME_AGE_MS;
export const MAX_VAULT_RESUME_TTL_MS = MAX_VAULT_RESUME_AGE_MS;

const RESUME_PERSISTENCE_ORDER = ["session", "remembered"] as const satisfies readonly VaultResumePersistence[];

const CAPABILITY_KEYS = [
  "format",
  "version",
  "tabToken",
  "vaultId",
  "wrappingSecret",
  "createdAt",
  "lastActivityAt",
  "absoluteExpiresAt",
] as const;

const REMEMBERED_HINT_KEYS = [
  "format",
  "version",
  "vaultId",
  "loginIdentifier",
  "absoluteExpiresAt",
] as const;

export type VaultResumeRecord = VaultResumeKeyEnvelope;

export interface VaultResumeCapabilityRecord {
  readonly format: "coffer-vault-resume-capability";
  readonly version: 2;
  readonly tabToken: string;
  readonly vaultId: string;
  readonly wrappingSecret: string;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  readonly absoluteExpiresAt: number;
}

export interface VaultResumeMetadata {
  readonly vaultId: string;
  readonly createdAt: number;
  readonly lastActivityAt: number;
  /** Compatibility alias for the hard absolute deadline. */
  readonly expiresAt: number;
  readonly absoluteExpiresAt: number;
  readonly persistence: VaultResumePersistence;
  readonly loginIdentifier?: string;
}

export interface VaultResumeSession extends VaultResumeMetadata {
  readonly runtime: VaultRuntime;
}

export interface RememberedVaultResumeHint {
  readonly vaultId: string;
  readonly loginIdentifier: string;
  readonly absoluteExpiresAt: number;
}

export type VaultResumeRecordStatus =
  | "valid"
  | "invalid"
  | "expired"
  | "vault-mismatch"
  | "tab-mismatch";

export class VaultResumeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VaultResumeError";
  }
}

type RememberedVaultResumeHintRecord = {
  readonly format: "coffer-vault-resume-remembered-hint";
  readonly version: 1;
  readonly vaultId: string;
  readonly loginIdentifier: string;
  readonly absoluteExpiresAt: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function base64UrlToBase64(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function hasCanonicalDecodedLength(
  value: unknown,
  encoding: "base64" | "base64url",
  expectedBytes: number,
): value is string {
  if (typeof value !== "string") return false;
  if (typeof atob !== "function" || typeof btoa !== "function") return false;

  if (encoding === "base64url") {
    if (
      value.length !== Math.ceil((expectedBytes * 8) / 6) ||
      !/^[A-Za-z0-9_-]+$/u.test(value)
    ) {
      return false;
    }
  } else if (
    value.length !== Math.ceil(expectedBytes / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    return false;
  }

  try {
    const binary = atob(
      encoding === "base64url" ? base64UrlToBase64(value) : value,
    );
    if (binary.length !== expectedBytes) return false;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const canonicalUrl = bytesToBase64Url(bytes);
    return encoding === "base64url"
      ? canonicalUrl === value
      : base64UrlToBase64(canonicalUrl) === value;
  } catch {
    return false;
  }
}

export function isVaultResumeTabToken(value: unknown): value is string {
  return hasCanonicalDecodedLength(value, "base64url", TAB_TOKEN_BYTES);
}

export function isVaultResumeWrappingSecret(value: unknown): value is string {
  return hasCanonicalDecodedLength(value, "base64url", WRAPPING_SECRET_BYTES);
}

export function isVaultResumeVaultId(value: unknown): value is string {
  return hasCanonicalDecodedLength(value, "base64", VAULT_ID_BYTES);
}

function normalizeLoginIdentifier(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > 254) return null;
  return trimmed;
}

function isRememberedVaultResumeHintRecord(
  value: unknown,
): value is RememberedVaultResumeHintRecord {
  return (
    isRecord(value) &&
    hasExactKeys(value, REMEMBERED_HINT_KEYS) &&
    value.format === "coffer-vault-resume-remembered-hint" &&
    value.version === 1 &&
    isVaultResumeVaultId(value.vaultId) &&
    normalizeLoginIdentifier(
      typeof value.loginIdentifier === "string" ? value.loginIdentifier : undefined,
    ) === value.loginIdentifier &&
    isSafeTimestamp(value.absoluteExpiresAt)
  );
}

export function createVaultResumeTabToken(): string {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new VaultResumeError("Secure random generation is unavailable.");
  }
  const bytes = cryptoApi.getRandomValues(new Uint8Array(TAB_TOKEN_BYTES));
  try {
    const token = bytesToBase64Url(bytes);
    if (!isVaultResumeTabToken(token)) {
      throw new VaultResumeError("A secure tab token could not be created.");
    }
    return token;
  } finally {
    bytes.fill(0);
  }
}

export function isVaultResumeRecord(value: unknown): value is VaultResumeRecord {
  return isVaultResumeKeyEnvelope(value);
}

export function createVaultResumeRecord(
  envelope: VaultResumeKeyEnvelope,
): VaultResumeRecord {
  if (!isVaultResumeRecord(envelope)) {
    throw new VaultResumeError("Refusing to persist an invalid vault resume envelope.");
  }
  return { ...envelope };
}

export function classifyVaultResumeRecord(
  value: unknown,
  expectedVaultId: string,
  expectedTabToken: string,
  now: number,
): VaultResumeRecordStatus {
  if (
    !isVaultResumeVaultId(expectedVaultId) ||
    !isVaultResumeTabToken(expectedTabToken) ||
    !isSafeTimestamp(now) ||
    !isVaultResumeRecord(value)
  ) {
    return "invalid";
  }
  if (value.tabToken !== expectedTabToken) return "tab-mismatch";
  if (value.vaultId !== expectedVaultId) return "vault-mismatch";
  if (value.createdAt > now) return "invalid";
  if (value.absoluteExpiresAt <= now) return "expired";
  return "valid";
}

export function isVaultResumeCapabilityRecord(
  value: unknown,
): value is VaultResumeCapabilityRecord {
  if (!isRecord(value) || !hasExactKeys(value, CAPABILITY_KEYS)) return false;
  const resumeAgeMs = Number(value.absoluteExpiresAt) - Number(value.createdAt);
  return (
    value.format === "coffer-vault-resume-capability" &&
    value.version === 2 &&
    isVaultResumeTabToken(value.tabToken) &&
    isVaultResumeVaultId(value.vaultId) &&
    isVaultResumeWrappingSecret(value.wrappingSecret) &&
    isSafeTimestamp(value.createdAt) &&
    isSafeTimestamp(value.lastActivityAt) &&
    isSafeTimestamp(value.absoluteExpiresAt) &&
    value.createdAt <= value.lastActivityAt &&
    value.lastActivityAt < value.absoluteExpiresAt &&
    resumeAgeMs > 0 &&
    resumeAgeMs <= MAX_VAULT_RESUME_TTL_MS
  );
}

export function createVaultResumeCapabilityRecord(
  material: VaultResumeSealingMaterial,
  lastActivityAt: number,
): VaultResumeCapabilityRecord {
  const { envelope, wrappingSecret } = material;
  if (
    !isVaultResumeRecord(envelope) ||
    !isVaultResumeWrappingSecret(wrappingSecret) ||
    !isSafeTimestamp(lastActivityAt) ||
    lastActivityAt < envelope.createdAt ||
    lastActivityAt >= envelope.absoluteExpiresAt
  ) {
    throw new VaultResumeError("Refusing to create an invalid resume capability.");
  }
  return {
    format: "coffer-vault-resume-capability",
    version: 2,
    tabToken: envelope.tabToken,
    vaultId: envelope.vaultId,
    wrappingSecret,
    createdAt: envelope.createdAt,
    lastActivityAt,
    absoluteExpiresAt: envelope.absoluteExpiresAt,
  };
}

export function classifyVaultResumeCapability(
  value: unknown,
  expectedVaultId: string,
  now: number,
): VaultResumeRecordStatus {
  if (
    !isVaultResumeVaultId(expectedVaultId) ||
    !isSafeTimestamp(now) ||
    !isVaultResumeCapabilityRecord(value)
  ) {
    return "invalid";
  }
  if (value.vaultId !== expectedVaultId) return "vault-mismatch";
  if (value.createdAt > now || value.lastActivityAt > now) return "invalid";
  if (value.absoluteExpiresAt <= now) return "expired";
  return "valid";
}

function capabilityMatchesRecord(
  capability: VaultResumeCapabilityRecord,
  record: VaultResumeRecord,
): boolean {
  return (
    capability.tabToken === record.tabToken &&
    capability.vaultId === record.vaultId &&
    capability.createdAt === record.createdAt &&
    capability.absoluteExpiresAt === record.absoluteExpiresAt
  );
}

type StoredVaultResumeCapability = {
  readonly capability: VaultResumeCapabilityRecord;
  readonly persistence: VaultResumePersistence;
};

function toMetadata(
  capability: VaultResumeCapabilityRecord,
  persistence: VaultResumePersistence,
): VaultResumeMetadata {
  return {
    vaultId: capability.vaultId,
    createdAt: capability.createdAt,
    lastActivityAt: capability.lastActivityAt,
    expiresAt: capability.absoluteExpiresAt,
    absoluteExpiresAt: capability.absoluteExpiresAt,
    persistence,
  };
}

function capabilityKey(persistence: VaultResumePersistence): string {
  return persistence === "remembered" ? REMEMBERED_CAPABILITY_KEY : SESSION_CAPABILITY_KEY;
}

function storageApi(persistence: VaultResumePersistence): Storage {
  try {
    const storage = persistence === "remembered"
      ? globalThis.localStorage
      : globalThis.sessionStorage;
    if (!storage) throw new Error(`${persistence} storage is unavailable`);
    return storage;
  } catch (error) {
    throw new VaultResumeError(
      persistence === "remembered"
        ? "Persistent browser storage is unavailable."
        : "Same-tab session storage is unavailable.",
      {
      cause: error,
      },
    );
  }
}

function optionalStorageApi(persistence: VaultResumePersistence): Storage | null {
  try {
    return storageApi(persistence);
  } catch {
    return null;
  }
}

function removeCapability(storage: Storage, persistence: VaultResumePersistence): void {
  storage.removeItem(capabilityKey(persistence));
  if (persistence === "remembered") storage.removeItem(REMEMBERED_HINT_KEY);
}

function parseCapability(value: string | null): unknown {
  if (value === null || value.length > 2_048) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function readCapability(
  expectedVaultId: string,
  now: number,
): StoredVaultResumeCapability | null {
  for (const persistence of RESUME_PERSISTENCE_ORDER) {
    const storage = optionalStorageApi(persistence);
    if (!storage) continue;
    const parsed = parseCapability(storage.getItem(capabilityKey(persistence)));
    if (classifyVaultResumeCapability(parsed, expectedVaultId, now) !== "valid") {
      removeCapability(storage, persistence);
      continue;
    }
    if (!isVaultResumeCapabilityRecord(parsed)) {
      removeCapability(storage, persistence);
      continue;
    }
    return { capability: parsed, persistence };
  }
  return null;
}

function writeCapability(
  capability: VaultResumeCapabilityRecord,
  persistence: VaultResumePersistence,
): void {
  if (!isVaultResumeCapabilityRecord(capability)) {
    throw new VaultResumeError("Refusing to persist an invalid resume capability.");
  }
  const storage = storageApi(persistence);
  const serialized = JSON.stringify(capability);
  try {
    for (const existingPersistence of RESUME_PERSISTENCE_ORDER) {
      if (existingPersistence === persistence) continue;
      const storage = optionalStorageApi(existingPersistence);
      if (!storage) continue;
      removeCapability(storage, existingPersistence);
    }
    storage.setItem(capabilityKey(persistence), serialized);
    if (storage.getItem(capabilityKey(persistence)) !== serialized) {
      throw new Error(`${persistence} storage did not retain the capability`);
    }
    for (const existingPersistence of RESUME_PERSISTENCE_ORDER) {
      if (existingPersistence === persistence) continue;
      const existingStorage = optionalStorageApi(existingPersistence);
      if (!existingStorage) continue;
      removeCapability(existingStorage, existingPersistence);
    }
  } catch (error) {
    try {
      removeCapability(storage, persistence);
    } catch {
      // The caller still receives no usable resume session.
    }
    throw new VaultResumeError(
      persistence === "remembered"
        ? "Persistent resume capability could not be saved."
        : "Same-tab resume capability could not be saved.",
      {
        cause: error,
      },
    );
  }
}

function clearCapabilitiesAndReturnTokens(expectedTabToken?: string): string[] {
  const tokens: string[] = [];
  for (const persistence of RESUME_PERSISTENCE_ORDER) {
    const storage = optionalStorageApi(persistence);
    if (!storage) continue;
    const parsed = parseCapability(storage.getItem(capabilityKey(persistence)));
    const token = isRecord(parsed) && isVaultResumeTabToken(parsed.tabToken)
      ? parsed.tabToken
      : null;
    if (expectedTabToken && token && token !== expectedTabToken) continue;
    removeCapability(storage, persistence);
    if (token) tokens.push(token);
  }
  return tokens;
}

function writeRememberedHint(
  capability: VaultResumeCapabilityRecord,
  loginIdentifier: string | undefined,
): void {
  const identifier = normalizeLoginIdentifier(loginIdentifier);
  const storage = storageApi("remembered");
  if (!identifier) {
    storage.removeItem(REMEMBERED_HINT_KEY);
    return;
  }
  const hint: RememberedVaultResumeHintRecord = {
    format: "coffer-vault-resume-remembered-hint",
    version: 1,
    vaultId: capability.vaultId,
    loginIdentifier: identifier,
    absoluteExpiresAt: capability.absoluteExpiresAt,
  };
  storage.setItem(REMEMBERED_HINT_KEY, JSON.stringify(hint));
}

function clearRememberedHint(): void {
  optionalStorageApi("remembered")?.removeItem(REMEMBERED_HINT_KEY);
}

export function readRememberedVaultResumeHint(
  now = Date.now(),
): RememberedVaultResumeHint | null {
  const storage = optionalStorageApi("remembered");
  if (!storage) return null;
  const parsedHint = parseCapability(storage.getItem(REMEMBERED_HINT_KEY));
  if (
    !isRememberedVaultResumeHintRecord(parsedHint) ||
    parsedHint.absoluteExpiresAt <= now
  ) {
    storage.removeItem(REMEMBERED_HINT_KEY);
    return null;
  }

  const parsedCapability = parseCapability(storage.getItem(REMEMBERED_CAPABILITY_KEY));
  if (
    classifyVaultResumeCapability(parsedCapability, parsedHint.vaultId, now) !==
      "valid" ||
    !isVaultResumeCapabilityRecord(parsedCapability) ||
    parsedCapability.absoluteExpiresAt !== parsedHint.absoluteExpiresAt
  ) {
    removeCapability(storage, "remembered");
    return null;
  }
  return {
    vaultId: parsedHint.vaultId,
    loginIdentifier: parsedHint.loginIdentifier,
    absoluteExpiresAt: parsedHint.absoluteExpiresAt,
  };
}

function clearLegacyToken(): string | null {
  const storage = storageApi("session");
  const value = storage.getItem(LEGACY_SESSION_TOKEN_KEY);
  const token = isVaultResumeTabToken(value) ? value : null;
  storage.removeItem(LEGACY_SESSION_TOKEN_KEY);
  return token;
}

export function touchVaultResumeSession(
  expectedVaultId: string,
  now = Date.now(),
): boolean {
  try {
    const stored = readCapability(expectedVaultId, now);
    if (!stored) return false;
    const touched: VaultResumeCapabilityRecord = {
      ...stored.capability,
      lastActivityAt: now,
    };
    if (!isVaultResumeCapabilityRecord(touched)) {
      clearCapabilitiesAndReturnTokens(stored.capability.tabToken);
      return false;
    }
    writeCapability(touched, stored.persistence);
    return true;
  } catch {
    try {
      clearCapabilitiesAndReturnTokens();
    } catch {
      // Failing closed means no activity timestamp is accepted.
    }
    return false;
  }
}

function requestResult<T>(
  request: IDBRequest<T>,
  transaction: IDBTransaction,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      callback();
    };
    const timeout = globalThis.setTimeout(() => {
      try {
        transaction.abort();
      } catch {
        // A transaction that completed at the timeout boundary cannot be aborted.
      }
      finish(() => reject(new VaultResumeError("IndexedDB request timed out.")));
    }, OPERATION_TIMEOUT_MS);
    request.addEventListener("success", () => finish(() => resolve(request.result)), {
      once: true,
    });
    request.addEventListener("error", () => {
      finish(() => reject(
        request.error ?? new VaultResumeError("IndexedDB request failed."),
      ));
    }, { once: true });
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      callback();
    };
    const timeout = globalThis.setTimeout(() => {
      try {
        transaction.abort();
      } catch {
        // A transaction that completed at the timeout boundary cannot be aborted.
      }
      finish(() => reject(new VaultResumeError("IndexedDB transaction timed out.")));
    }, OPERATION_TIMEOUT_MS);
    transaction.addEventListener("complete", () => finish(resolve), { once: true });
    transaction.addEventListener("abort", () => {
      finish(() => reject(
        transaction.error ?? new VaultResumeError("IndexedDB transaction aborted."),
      ));
    }, { once: true });
    transaction.addEventListener("error", () => {
      finish(() => reject(
        transaction.error ?? new VaultResumeError("IndexedDB transaction failed."),
      ));
    }, { once: true });
  });
}

function writableTransaction(database: IDBDatabase): IDBTransaction {
  try {
    return database.transaction(STORE_NAME, "readwrite", { durability: "strict" });
  } catch {
    return database.transaction(STORE_NAME, "readwrite");
  }
}

async function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    throw new VaultResumeError("Secure browser resume storage is unavailable.");
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      callback();
    };
    const timeout = globalThis.setTimeout(() => {
      finish(() => reject(new VaultResumeError("Secure browser resume storage timed out.")));
    }, OPERATION_TIMEOUT_MS);
    request.addEventListener("upgradeneeded", (event) => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      } else if ((event as IDBVersionChangeEvent).oldVersion < 2) {
        request.transaction?.objectStore(STORE_NAME).clear();
      }
    });
    request.addEventListener("success", () => {
      if (settled) {
        request.result.close();
        return;
      }
      finish(() => resolve(request.result));
    }, { once: true });
    request.addEventListener("error", () => {
      finish(() => reject(new VaultResumeError(
        "Secure browser resume storage could not be opened.",
        { cause: request.error },
      )));
    }, { once: true });
    request.addEventListener("blocked", () => {
      finish(() => reject(new VaultResumeError(
        "Secure browser resume storage is blocked by another tab.",
      )));
    }, { once: true });
  });
}

async function sweepInvalidOrExpiredRecords(
  database: IDBDatabase,
  now: number,
): Promise<void> {
  const transaction = writableTransaction(database);
  const completion = transactionComplete(transaction);
  void completion.catch(() => undefined);
  const request = transaction.objectStore(STORE_NAME).openCursor();
  let scanned = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      callback();
    };
    const timeout = globalThis.setTimeout(() => {
      try {
        transaction.abort();
      } catch {
        // The transaction may have completed at the timeout boundary.
      }
      finish(() => reject(new VaultResumeError("Resume record cleanup timed out.")));
    }, OPERATION_TIMEOUT_MS);
    request.addEventListener("error", () => {
      finish(() => reject(request.error ?? new VaultResumeError("Resume record cleanup failed.")));
    }, { once: true });
    request.addEventListener("success", () => {
      const cursor = request.result;
      if (!cursor || scanned >= MAX_SWEEP_RECORDS) {
        finish(resolve);
        return;
      }
      scanned += 1;
      const value = cursor.value as unknown;
      if (
        !isVaultResumeRecord(value) ||
        value.createdAt > now ||
        value.absoluteExpiresAt <= now
      ) {
        cursor.delete();
      }
      cursor.continue();
    });
  });
  await completion;
}

async function deleteStoredRecord(tabToken: string): Promise<void> {
  const database = await openDatabase();
  try {
    await sweepInvalidOrExpiredRecords(database, Date.now()).catch(() => undefined);
    const transaction = writableTransaction(database);
    const completion = transactionComplete(transaction);
    void completion.catch(() => undefined);
    await requestResult(
      transaction.objectStore(STORE_NAME).delete(tabToken),
      transaction,
    );
    await completion;
  } finally {
    database.close();
  }
}

async function writeStoredRecord(record: VaultResumeRecord): Promise<void> {
  if (!isVaultResumeRecord(record)) {
    throw new VaultResumeError("Refusing to persist an invalid resume envelope.");
  }
  const database = await openDatabase();
  try {
    await sweepInvalidOrExpiredRecords(database, Date.now()).catch(() => undefined);
    const transaction = writableTransaction(database);
    const completion = transactionComplete(transaction);
    void completion.catch(() => undefined);
    await requestResult(
      transaction.objectStore(STORE_NAME).put({ ...record }, record.tabToken),
      transaction,
    );
    await completion;
  } finally {
    database.close();
  }
}

async function readStoredRecord(
  tabToken: string,
  expectedVaultId: string,
  now: number,
): Promise<VaultResumeRecord | null> {
  const database = await openDatabase();
  try {
    await sweepInvalidOrExpiredRecords(database, now).catch(() => undefined);
    const transaction = writableTransaction(database);
    const completion = transactionComplete(transaction);
    void completion.catch(() => undefined);
    const store = transaction.objectStore(STORE_NAME);
    const value = await requestResult(store.get(tabToken), transaction);
    if (
      value === undefined ||
      classifyVaultResumeRecord(value, expectedVaultId, tabToken, now) !== "valid"
    ) {
      if (value !== undefined) {
        await requestResult(store.delete(tabToken), transaction);
      }
      await completion;
      return null;
    }
    await completion;
    return value;
  } finally {
    database.close();
  }
}

export async function saveVaultResumeSession(
  vaultId: string,
  runtime: VaultRuntime,
  persistence: VaultResumePersistence = "session",
  loginIdentifier?: string,
): Promise<VaultResumeMetadata> {
  if (!isVaultResumeVaultId(vaultId)) {
    throw new VaultResumeError("The vault identifier is invalid.");
  }
  const material = getVaultResumeSealingMaterial(runtime);
  if (!material || material.envelope.vaultId !== vaultId) {
    throw new VaultResumeError("This runtime has no matching sealed resume material.");
  }

  const now = Date.now();
  const record = createVaultResumeRecord(material.envelope);
  const capability = createVaultResumeCapabilityRecord(material, now);
  const normalizedLoginIdentifier = normalizeLoginIdentifier(loginIdentifier);
  try {
    clearLegacyToken();
    writeCapability(capability, persistence);
    if (persistence === "remembered") {
      writeRememberedHint(capability, normalizedLoginIdentifier ?? undefined);
    } else {
      clearRememberedHint();
    }
    await writeStoredRecord(record);
    return {
      ...toMetadata(capability, persistence),
      ...(persistence === "remembered" && normalizedLoginIdentifier
        ? { loginIdentifier: normalizedLoginIdentifier }
        : {}),
    };
  } catch (error) {
    try {
      clearCapabilitiesAndReturnTokens(capability.tabToken);
      clearRememberedHint();
      await deleteStoredRecord(record.tabToken);
    } catch {
      // The missing session capability keeps any leftover ciphertext unusable.
    }
    throw new VaultResumeError("The unlocked vault session could not be saved.", {
      cause: error,
    });
  }
}

export async function readVaultResumeSession(
  expectedVaultId: string,
): Promise<VaultResumeSession | null> {
  if (!isVaultResumeVaultId(expectedVaultId)) {
    throw new VaultResumeError("The expected vault identifier is invalid.");
  }
  const now = Date.now();
  const legacyToken = clearLegacyToken();
  const stored = readCapability(expectedVaultId, now);
  if (!stored) {
    if (legacyToken) await deleteStoredRecord(legacyToken).catch(() => undefined);
    return null;
  }
  const { capability, persistence } = stored;

  try {
    const record = await readStoredRecord(capability.tabToken, expectedVaultId, now);
    if (!record || !capabilityMatchesRecord(capability, record)) {
      clearCapabilitiesAndReturnTokens(capability.tabToken);
      if (record) await deleteStoredRecord(record.tabToken).catch(() => undefined);
      return null;
    }
    const runtime = await restoreVaultRuntimeFromResumeEnvelope(
      record,
      capability.wrappingSecret,
    );
    const hint = persistence === "remembered"
      ? readRememberedVaultResumeHint(now)
      : null;
    return {
      runtime,
      ...toMetadata(capability, persistence),
      ...(hint?.vaultId === capability.vaultId
        ? { loginIdentifier: hint.loginIdentifier }
        : {}),
    };
  } catch (error) {
    try {
      clearCapabilitiesAndReturnTokens(capability.tabToken);
      await deleteStoredRecord(capability.tabToken);
    } catch {
      // The caller receives no usable runtime even if ciphertext cleanup fails.
    }
    throw new VaultResumeError("The unlocked vault session could not be restored.", {
      cause: error,
    });
  }
}

/** Compatibility wrapper. Activity updates are synchronous and never write IDB. */
export async function refreshVaultResumeSession(
  expectedVaultId: string,
): Promise<VaultResumeMetadata | null> {
  const now = Date.now();
  if (!touchVaultResumeSession(expectedVaultId, now)) return null;
  const stored = readCapability(expectedVaultId, now);
  return stored ? toMetadata(stored.capability, stored.persistence) : null;
}

export async function clearVaultResumeSession(): Promise<void> {
  let tabTokens: string[];
  let legacyToken: string | null;
  try {
    // This synchronous removal happens before the function's first await.
    tabTokens = clearCapabilitiesAndReturnTokens();
    legacyToken = clearLegacyToken();
  } catch (error) {
    throw new VaultResumeError("The unlocked vault capability could not be cleared.", {
      cause: error,
    });
  }
  const tokens = [...new Set([...tabTokens, legacyToken].filter(
    (token): token is string => token !== null,
  ))];
  if (tokens.length === 0) return;

  try {
    await Promise.all(tokens.map((token) => deleteStoredRecord(token)));
  } catch (error) {
    throw new VaultResumeError("The encrypted resume envelope could not be cleared.", {
      cause: error,
    });
  }
}
