import {
  MAX_VAULT_PAYLOAD_BYTES,
  type VaultPayloadCipher,
} from "./vault-crypto";

const DATABASE_NAME = "coffer-secure-vault";
const DATABASE_VERSION = 2;
const STORE_NAME = "encrypted-outbox";
const LEGACY_RECORD_KEY = "pending-vault-save";
const OUTBOX_OPERATION_TIMEOUT_MS = 5_000;
const MAX_CIPHERTEXT_BASE64_LENGTH =
  Math.ceil((MAX_VAULT_PAYLOAD_BYTES + 16) / 3) * 4;
const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

export interface VaultOutboxRecord {
  format: "coffer-encrypted-outbox";
  version: 1;
  vaultId: string;
  baseRevision: number;
  payload: VaultPayloadCipher;
  writtenAt: string;
}

export type VaultOutboxDecision = "replay" | "already-stored" | "conflict";

export class VaultOutboxError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VaultOutboxError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function decodedBase64Length(
  value: unknown,
  maximumLength: number,
): number | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumLength ||
    !CANONICAL_BASE64.test(value)
  ) {
    return null;
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    return null;
  }
  let canonical = "";
  for (let offset = 0; offset < binary.length; offset += 0x8000) {
    canonical += binary.slice(offset, offset + 0x8000);
  }
  return btoa(canonical) === value ? binary.length : null;
}

function isPayloadCipher(value: unknown): value is VaultPayloadCipher {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["algorithm", "iv", "ciphertext", "tagLength"]) ||
    value.algorithm !== "AES-256-GCM" ||
    value.tagLength !== 128 ||
    decodedBase64Length(value.iv, 16) !== 12
  ) {
    return false;
  }
  const ciphertextBytes = decodedBase64Length(
    value.ciphertext,
    MAX_CIPHERTEXT_BASE64_LENGTH,
  );
  return (
    ciphertextBytes !== null &&
    ciphertextBytes >= 16 &&
    ciphertextBytes <= MAX_VAULT_PAYLOAD_BYTES + 16
  );
}

export function isVaultOutboxRecord(value: unknown): value is VaultOutboxRecord {
  if (!isRecord(value)) return false;
  return (
    hasExactKeys(value, [
      "format",
      "version",
      "vaultId",
      "baseRevision",
      "payload",
      "writtenAt",
    ]) &&
    value.format === "coffer-encrypted-outbox" &&
    value.version === 1 &&
    decodedBase64Length(value.vaultId, 24) === 16 &&
    typeof value.baseRevision === "number" &&
    Number.isSafeInteger(value.baseRevision) &&
    value.baseRevision >= 1 &&
    isPayloadCipher(value.payload) &&
    typeof value.writtenAt === "string" &&
    value.writtenAt.length <= 64 &&
    Number.isFinite(Date.parse(value.writtenAt))
  );
}

export function createVaultOutboxRecord(
  vaultId: string,
  baseRevision: number,
  payload: VaultPayloadCipher,
  now = new Date(),
): VaultOutboxRecord {
  const record: VaultOutboxRecord = {
    format: "coffer-encrypted-outbox",
    version: 1,
    vaultId,
    baseRevision,
    payload: structuredClone(payload),
    writtenAt: now.toISOString(),
  };
  if (!isVaultOutboxRecord(record)) {
    throw new VaultOutboxError("The encrypted outbox record is invalid.");
  }
  return record;
}

export function payloadCipherEquals(
  left: VaultPayloadCipher,
  right: VaultPayloadCipher,
): boolean {
  return (
    left.algorithm === right.algorithm &&
    left.tagLength === right.tagLength &&
    left.iv === right.iv &&
    left.ciphertext === right.ciphertext
  );
}

export function classifyVaultOutbox(
  outbox: VaultOutboxRecord,
  vaultId: string,
  serverRevision: number,
  serverPayload: VaultPayloadCipher,
): VaultOutboxDecision {
  if (outbox.vaultId !== vaultId) return "conflict";
  if (payloadCipherEquals(outbox.payload, serverPayload)) return "already-stored";
  if (outbox.baseRevision === serverRevision) return "replay";
  return "conflict";
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener(
      "error",
      () => reject(request.error ?? new VaultOutboxError("IndexedDB request failed.")),
      { once: true },
    );
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      try {
        transaction.abort();
      } catch {
        // A transaction that completed at the timeout boundary cannot be aborted.
      }
      reject(new VaultOutboxError("IndexedDB transaction timed out."));
    }, OUTBOX_OPERATION_TIMEOUT_MS);
    transaction.addEventListener("complete", () => {
      window.clearTimeout(timeout);
      resolve();
    }, { once: true });
    transaction.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(transaction.error ?? new VaultOutboxError("IndexedDB transaction aborted."));
      },
      { once: true },
    );
    transaction.addEventListener(
      "error",
      () => {
        window.clearTimeout(timeout);
        reject(transaction.error ?? new VaultOutboxError("IndexedDB transaction failed."));
      },
      { once: true },
    );
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
    throw new VaultOutboxError("Encrypted browser storage is unavailable.");
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    const timeout = window.setTimeout(() => {
      settled = true;
      reject(new VaultOutboxError("Encrypted browser storage timed out."));
    }, OUTBOX_OPERATION_TIMEOUT_MS);
    request.addEventListener("upgradeneeded", (event) => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
      if (event.oldVersion < 2 && request.transaction) {
        const store = request.transaction.objectStore(STORE_NAME);
        const legacyRequest = store.get(LEGACY_RECORD_KEY);
        legacyRequest.addEventListener("success", () => {
          const legacy = legacyRequest.result;
          if (isVaultOutboxRecord(legacy)) {
            store.put(structuredClone(legacy), legacy.vaultId);
          }
          store.delete(LEGACY_RECORD_KEY);
        }, { once: true });
      }
    });
    request.addEventListener("success", () => {
      window.clearTimeout(timeout);
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    }, { once: true });
    request.addEventListener("error", () => {
      window.clearTimeout(timeout);
      if (settled) return;
      settled = true;
      reject(new VaultOutboxError("Encrypted browser storage could not be opened.", {
        cause: request.error,
      }));
    }, { once: true });
    request.addEventListener("blocked", () => {
      window.clearTimeout(timeout);
      if (settled) return;
      settled = true;
      reject(new VaultOutboxError("Encrypted browser storage is blocked by another tab."));
    }, { once: true });
  });
}

export async function readVaultOutbox(vaultId: string): Promise<VaultOutboxRecord | null> {
  if (decodedBase64Length(vaultId, 24) !== 16) {
    throw new VaultOutboxError("The vault identifier is invalid.");
  }
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completion = transactionComplete(transaction);
    void completion.catch(() => undefined);
    const value = await requestResult(transaction.objectStore(STORE_NAME).get(vaultId));
    await completion;
    if (value === undefined) return null;
    if (!isVaultOutboxRecord(value)) {
      throw new VaultOutboxError("Encrypted browser storage contains an invalid record.");
    }
    if (value.vaultId !== vaultId) {
      throw new VaultOutboxError("Encrypted browser storage returned the wrong vault record.");
    }
    return structuredClone(value);
  } finally {
    database.close();
  }
}

export async function writeVaultOutbox(record: VaultOutboxRecord): Promise<void> {
  if (!isVaultOutboxRecord(record)) {
    throw new VaultOutboxError("Refusing to persist an invalid encrypted outbox record.");
  }
  const database = await openDatabase();
  try {
    const transaction = writableTransaction(database);
    const completion = transactionComplete(transaction);
    void completion.catch(() => undefined);
    transaction.objectStore(STORE_NAME).put(structuredClone(record), record.vaultId);
    await completion;
  } catch (error) {
    throw new VaultOutboxError("The encrypted outbox could not be persisted.", {
      cause: error,
    });
  } finally {
    database.close();
  }
}

export async function clearVaultOutbox(target: string | VaultOutboxRecord): Promise<boolean> {
  const vaultId = typeof target === "string" ? target : target.vaultId;
  if (decodedBase64Length(vaultId, 24) !== 16) {
    throw new VaultOutboxError("The vault identifier is invalid.");
  }
  const database = await openDatabase();
  try {
    const transaction = writableTransaction(database);
    const completion = transactionComplete(transaction);
    void completion.catch(() => undefined);
    const store = transaction.objectStore(STORE_NAME);
    const current = await requestResult(store.get(vaultId));
    if (current === undefined) {
      await completion;
      return true;
    }
    if (!isVaultOutboxRecord(current)) {
      transaction.abort();
      await completion.catch(() => undefined);
      throw new VaultOutboxError("Encrypted browser storage contains an invalid record.");
    }
    if (
      typeof target !== "string" &&
      (current.vaultId !== target.vaultId ||
        current.baseRevision !== target.baseRevision ||
        !payloadCipherEquals(current.payload, target.payload))
    ) {
      await completion;
      return false;
    }
    store.delete(vaultId);
    await completion;
    return true;
  } finally {
    database.close();
  }
}
