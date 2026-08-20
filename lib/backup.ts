import {
  MAX_VAULT_ACCOUNT_ICON_BYTES,
  parseAccountIconDataUrl,
  parseLocalIconBrand,
} from "./vault-model";

export const COFFER_BACKUP_FORMAT = "coffer-backup" as const;
export const LEGACY_COFFER_BACKUP_VERSION = 1 as const;
export const COFFER_BACKUP_VERSION = 2 as const;
export const COFFER_BACKUP_KDF_ITERATIONS = 600_000 as const;

export const MAX_BACKUP_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_BACKUP_PLAINTEXT_BYTES = 5 * 1024 * 1024;
export const MAX_BACKUP_ACCOUNTS = 1_000;

const BACKUP_CONTENT_TYPE = "application/vnd.coffer.accounts+json" as const;
const KDF_ALGORITHM = "PBKDF2-HMAC-SHA-256" as const;
const ENCRYPTION_ALGORITHM = "AES-256-GCM" as const;
const AES_GCM_TAG_LENGTH = 128 as const;
const AES_KEY_LENGTH = 256 as const;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const MAX_SALT_BYTES = 64;
const MAX_PASSWORD_LENGTH = 1_024;
const MAX_SERVICE_LENGTH = 256;
const MAX_IDENTITY_LENGTH = 512;
const MAX_GROUP_LENGTH = 128;
const MAX_SECRET_LENGTH = 1_024;

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export type CofferTotpAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

export type CofferAccount = {
  service: string;
  identity: string;
  secret: string;
  group: string;
  favorite: boolean;
  archived: boolean;
  algorithm?: CofferTotpAlgorithm;
  digits?: 6 | 8;
  period?: number;
  /** A bundled local brand id. Missing keeps legacy backups backward compatible. */
  iconBrand?: string | null;
  /** A normalized local PNG. Missing and explicit null intentionally remain distinct. */
  iconDataUrl?: string | null;
};

export function projectCofferAccount(account: CofferAccount): CofferAccount {
  const projected: CofferAccount = {
    service: account.service,
    identity: account.identity,
    secret: account.secret,
    group: account.group,
    favorite: account.favorite,
    archived: account.archived,
    algorithm: account.algorithm ?? "SHA-1",
    digits: account.digits ?? 6,
    period: account.period ?? 30,
  };
  if (account.iconBrand !== undefined) projected.iconBrand = account.iconBrand;
  if (account.iconDataUrl !== undefined) projected.iconDataUrl = account.iconDataUrl;
  return projected;
}

export type BackupInput = string | ArrayBuffer | Uint8Array;

type PlainBackupEnvelope = {
  format: typeof COFFER_BACKUP_FORMAT;
  version: SupportedCofferBackupVersion;
  kind: "accounts";
  accounts: CofferAccount[];
};

type KdfDescriptor = {
  algorithm: typeof KDF_ALGORITHM;
  iterations: typeof COFFER_BACKUP_KDF_ITERATIONS;
  salt: string;
};

type EncryptionDescriptor = {
  algorithm: typeof ENCRYPTION_ALGORITHM;
  iv: string;
  tagLength: typeof AES_GCM_TAG_LENGTH;
};

type EncryptedBackupEnvelope = {
  format: typeof COFFER_BACKUP_FORMAT;
  version: SupportedCofferBackupVersion;
  kind: "encrypted";
  contentType: typeof BACKUP_CONTENT_TYPE;
  encryption: EncryptionDescriptor;
  kdf: KdfDescriptor;
  ciphertext: string;
};

type JsonRecord = Record<string, unknown>;

type SupportedCofferBackupVersion =
  | typeof LEGACY_COFFER_BACKUP_VERSION
  | typeof COFFER_BACKUP_VERSION;

function cryptoApi(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error("Web Crypto is not available in this environment");
  }
  return globalThis.crypto;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(value: JsonRecord, expected: readonly string[], field: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new Error(`${field} contains missing or unsupported fields`);
  }
}

function assertPlainString(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new Error(`${field} must be a non-empty string of at most ${maximumLength} characters`);
  }
  if (value.trim().length === 0 || containsControlCharacters(value)) {
    throw new Error(`${field} contains unsupported control characters`);
  }
  return value;
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function normalizeAndValidateBase32(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SECRET_LENGTH + 256) {
    throw new Error(`${field} must be a valid Base32 string`);
  }

  if (value !== value.trim()) throw new Error(`${field} must be a valid Base32 string`);
  const compact = value.toUpperCase();
  const match = /^([A-Z2-7]+)(=*)$/u.exec(compact);
  if (!match) throw new Error(`${field} must be a valid Base32 string`);

  const secret = match[1];
  const padding = match[2];
  if (secret.length < 16 || secret.length > MAX_SECRET_LENGTH) {
    throw new Error(`${field} must contain between 16 and ${MAX_SECRET_LENGTH} Base32 characters`);
  }

  const remainder = secret.length % 8;
  const paddingByRemainder: Readonly<Record<number, number>> = { 0: 0, 2: 6, 4: 4, 5: 3, 7: 1 };
  const requiredPadding = paddingByRemainder[remainder];
  if (requiredPadding === undefined || (padding.length > 0 && padding.length !== requiredPadding)) {
    throw new Error(`${field} has invalid Base32 padding`);
  }

  const unusedBitsByRemainder: Readonly<Record<number, number>> = { 0: 0, 2: 2, 4: 4, 5: 1, 7: 3 };
  const unusedBits = unusedBitsByRemainder[remainder];
  if (unusedBits > 0) {
    const finalValue = base32Alphabet.indexOf(secret[secret.length - 1]);
    if ((finalValue & ((1 << unusedBits) - 1)) !== 0) {
      throw new Error(`${field} contains non-zero Base32 padding bits`);
    }
  }

  return secret;
}

function validateAccount(
  value: unknown,
  index: number,
  version: SupportedCofferBackupVersion,
): CofferAccount {
  const field = `accounts[${index}]`;
  if (!isRecord(value)) throw new Error(`${field} must be an object`);

  const requiredKeys = ["service", "identity", "secret", "group", "favorite", "archived"];
  const optionalKeys = version === COFFER_BACKUP_VERSION
    ? ["algorithm", "digits", "period", "iconBrand", "iconDataUrl"]
    : ["algorithm", "digits", "period", "iconBrand"];
  const actualKeys = Object.keys(value);
  if (
    requiredKeys.some((key) => !Object.hasOwn(value, key)) ||
    actualKeys.some((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key))
  ) {
    throw new Error(`${field} contains missing or unsupported fields`);
  }

  if (typeof value.favorite !== "boolean") throw new Error(`${field}.favorite must be a boolean`);
  if (typeof value.archived !== "boolean") throw new Error(`${field}.archived must be a boolean`);

  const account: CofferAccount = {
    service: assertPlainString(value.service, `${field}.service`, MAX_SERVICE_LENGTH),
    identity: assertPlainString(value.identity, `${field}.identity`, MAX_IDENTITY_LENGTH),
    secret: normalizeAndValidateBase32(value.secret, `${field}.secret`),
    group: assertPlainString(value.group, `${field}.group`, MAX_GROUP_LENGTH),
    favorite: value.favorite,
    archived: value.archived,
  };

  if (Object.hasOwn(value, "algorithm")) {
    if (value.algorithm !== "SHA-1" && value.algorithm !== "SHA-256" && value.algorithm !== "SHA-512") {
      throw new Error(`${field}.algorithm must be SHA-1, SHA-256, or SHA-512`);
    }
    account.algorithm = value.algorithm;
  }

  if (Object.hasOwn(value, "digits")) {
    if (value.digits !== 6 && value.digits !== 8) {
      throw new Error(`${field}.digits must be 6 or 8`);
    }
    account.digits = value.digits;
  }

  if (Object.hasOwn(value, "period")) {
    if (!Number.isInteger(value.period) || (value.period as number) < 1 || (value.period as number) > 300) {
      throw new Error(`${field}.period must be an integer between 1 and 300 seconds`);
    }
    account.period = value.period as number;
  }

  if (Object.hasOwn(value, "iconBrand")) {
    account.iconBrand = parseLocalIconBrand(value.iconBrand, `${field}.iconBrand`);
  }

  if (Object.hasOwn(value, "iconDataUrl")) {
    account.iconDataUrl = parseAccountIconDataUrl(value.iconDataUrl, `${field}.iconDataUrl`);
  }
  if (account.iconBrand && account.iconDataUrl) {
    throw new Error(`${field} cannot use both iconBrand and iconDataUrl`);
  }

  return account;
}

function validateAccounts(value: unknown, version: SupportedCofferBackupVersion): CofferAccount[] {
  if (!Array.isArray(value)) throw new Error("accounts must be an array");
  if (value.length > MAX_BACKUP_ACCOUNTS) {
    throw new Error(`A backup cannot contain more than ${MAX_BACKUP_ACCOUNTS} accounts`);
  }
  const accounts = value.map((account, index) => validateAccount(account, index, version));
  const iconBytes = accounts.reduce((total, account) => {
    if (!account.iconDataUrl) return total;
    const encoded = account.iconDataUrl.slice(account.iconDataUrl.indexOf(",") + 1);
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    return total + (encoded.length / 4) * 3 - padding;
  }, 0);
  if (iconBytes > MAX_VAULT_ACCOUNT_ICON_BYTES) {
    throw new Error(`Backup account icons must total at most ${MAX_VAULT_ACCOUNT_ICON_BYTES} bytes`);
  }
  return accounts;
}

function inputToText(input: BackupInput, maximumBytes: number): string {
  if (typeof input === "string") {
    if (input.length > maximumBytes || utf8Encoder.encode(input).byteLength > maximumBytes) {
      throw new Error(`Backup exceeds the ${maximumBytes}-byte size limit`);
    }
    return input;
  }

  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > maximumBytes) {
    throw new Error(`Backup exceeds the ${maximumBytes}-byte size limit`);
  }
  try {
    return utf8Decoder.decode(bytes);
  } catch {
    throw new Error("Backup must be valid UTF-8 JSON");
  }
}

function parseJson(input: BackupInput, maximumBytes: number): unknown {
  const text = inputToText(input, maximumBytes);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Backup must be valid JSON");
  }
}

function validatePlainEnvelope(value: unknown): PlainBackupEnvelope {
  if (!isRecord(value)) throw new Error("Plain backup must be an object");
  assertExactKeys(value, ["format", "version", "kind", "accounts"], "Plain backup");
  if (value.format !== COFFER_BACKUP_FORMAT) throw new Error("Not a Coffer backup");
  if (value.version !== LEGACY_COFFER_BACKUP_VERSION && value.version !== COFFER_BACKUP_VERSION) {
    throw new Error("Unsupported Coffer backup version");
  }
  if (value.kind !== "accounts") throw new Error("Expected a plain Coffer accounts backup");

  return {
    format: COFFER_BACKUP_FORMAT,
    version: value.version,
    kind: "accounts",
    accounts: validateAccounts(value.accounts, value.version),
  };
}

function validateEncryptedEnvelope(value: unknown): EncryptedBackupEnvelope {
  if (!isRecord(value)) throw new Error("Encrypted backup must be an object");
  assertExactKeys(
    value,
    ["format", "version", "kind", "contentType", "encryption", "kdf", "ciphertext"],
    "Encrypted backup",
  );
  if (value.format !== COFFER_BACKUP_FORMAT) throw new Error("Not a Coffer backup");
  if (value.version !== LEGACY_COFFER_BACKUP_VERSION && value.version !== COFFER_BACKUP_VERSION) {
    throw new Error("Unsupported Coffer backup version");
  }
  if (value.kind !== "encrypted") throw new Error("Expected an encrypted Coffer backup");
  if (value.contentType !== BACKUP_CONTENT_TYPE) throw new Error("Unsupported Coffer backup content type");
  if (!isRecord(value.encryption)) throw new Error("encryption must be an object");
  if (!isRecord(value.kdf)) throw new Error("kdf must be an object");

  assertExactKeys(value.encryption, ["algorithm", "iv", "tagLength"], "encryption");
  assertExactKeys(value.kdf, ["algorithm", "iterations", "salt"], "kdf");
  if (value.encryption.algorithm !== ENCRYPTION_ALGORITHM) throw new Error("Unsupported encryption algorithm");
  if (value.encryption.tagLength !== AES_GCM_TAG_LENGTH) throw new Error("Unsupported AES-GCM tag length");
  if (value.kdf.algorithm !== KDF_ALGORITHM) throw new Error("Unsupported password KDF");
  if (value.kdf.iterations !== COFFER_BACKUP_KDF_ITERATIONS) throw new Error("Unsupported PBKDF2 work factor");
  if (typeof value.encryption.iv !== "string") throw new Error("encryption.iv must be Base64url text");
  if (typeof value.kdf.salt !== "string") throw new Error("kdf.salt must be Base64url text");
  if (typeof value.ciphertext !== "string") throw new Error("ciphertext must be Base64url text");

  const iv = base64UrlToBytes(value.encryption.iv, "encryption.iv");
  const salt = base64UrlToBytes(value.kdf.salt, "kdf.salt");
  const ciphertext = base64UrlToBytes(value.ciphertext, "ciphertext");
  if (iv.byteLength !== IV_BYTES) throw new Error("AES-GCM IV must be 96 bits");
  if (salt.byteLength < SALT_BYTES || salt.byteLength > MAX_SALT_BYTES) {
    throw new Error(`PBKDF2 salt must be between ${SALT_BYTES} and ${MAX_SALT_BYTES} bytes`);
  }
  if (ciphertext.byteLength <= AES_GCM_TAG_LENGTH / 8) throw new Error("Encrypted payload is empty or truncated");

  return {
    format: COFFER_BACKUP_FORMAT,
    version: value.version,
    kind: "encrypted",
    contentType: BACKUP_CONTENT_TYPE,
    encryption: {
      algorithm: ENCRYPTION_ALGORITHM,
      iv: value.encryption.iv,
      tagLength: AES_GCM_TAG_LENGTH,
    },
    kdf: {
      algorithm: KDF_ALGORITHM,
      iterations: COFFER_BACKUP_KDF_ITERATIONS,
      salt: value.kdf.salt,
    },
    ciphertext: value.ciphertext,
  };
}

function base64UrlToBytes(value: string, field: string): Uint8Array {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length % 4 === 1) {
    throw new Error(`${field} must use unpadded Base64url encoding`);
  }
  const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    if (bytesToBase64Url(bytes) !== value) throw new Error("non-canonical Base64url");
    return bytes;
  } catch {
    throw new Error(`${field} must use valid unpadded Base64url encoding`);
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function validatePassword(password: string): Uint8Array {
  if (typeof password !== "string" || password.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password must contain between 1 and ${MAX_PASSWORD_LENGTH} characters`);
  }
  return utf8Encoder.encode(password);
}

async function deriveBackupKey(password: Uint8Array, salt: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  const webCrypto = cryptoApi();
  const keyMaterial = await webCrypto.subtle.importKey(
    "raw",
    copyToArrayBuffer(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return webCrypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: COFFER_BACKUP_KDF_ITERATIONS,
      salt: copyToArrayBuffer(salt),
    },
    keyMaterial,
    { name: "AES-GCM", length: AES_KEY_LENGTH },
    false,
    [usage],
  );
}

function protectedHeader(envelope: Omit<EncryptedBackupEnvelope, "ciphertext">): Uint8Array {
  return utf8Encoder.encode(JSON.stringify(envelope));
}

function buildPlainEnvelope(accounts: readonly CofferAccount[]): PlainBackupEnvelope {
  return {
    format: COFFER_BACKUP_FORMAT,
    version: COFFER_BACKUP_VERSION,
    kind: "accounts",
    accounts: validateAccounts(accounts, COFFER_BACKUP_VERSION),
  };
}

function serializePlainEnvelope(envelope: PlainBackupEnvelope, pretty: boolean): string {
  const serialized = JSON.stringify(envelope, null, pretty ? 2 : undefined);
  if (utf8Encoder.encode(serialized).byteLength > MAX_BACKUP_PLAINTEXT_BYTES) {
    throw new Error(`Plain backup exceeds the ${MAX_BACKUP_PLAINTEXT_BYTES}-byte size limit`);
  }
  return serialized;
}

/** Creates a human-readable, unencrypted Coffer JSON backup. */
export function createPlainBackup(accounts: readonly CofferAccount[]): string {
  return serializePlainEnvelope(buildPlainEnvelope(accounts), true);
}

/** Parses and strictly validates an unencrypted Coffer JSON backup. */
export function parsePlainBackup(input: BackupInput): CofferAccount[] {
  return validatePlainEnvelope(parseJson(input, MAX_BACKUP_PLAINTEXT_BYTES)).accounts;
}

/** Creates a password-encrypted, self-describing Coffer JSON backup. */
export async function createEncryptedBackup(
  accounts: readonly CofferAccount[],
  password: string,
): Promise<string> {
  const webCrypto = cryptoApi();
  const passwordBytes = validatePassword(password);
  const plaintext = utf8Encoder.encode(serializePlainEnvelope(buildPlainEnvelope(accounts), false));
  const salt = webCrypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = webCrypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveBackupKey(passwordBytes, salt, "encrypt");

  const header: Omit<EncryptedBackupEnvelope, "ciphertext"> = {
    format: COFFER_BACKUP_FORMAT,
    version: COFFER_BACKUP_VERSION,
    kind: "encrypted",
    contentType: BACKUP_CONTENT_TYPE,
    encryption: {
      algorithm: ENCRYPTION_ALGORITHM,
      iv: bytesToBase64Url(iv),
      tagLength: AES_GCM_TAG_LENGTH,
    },
    kdf: {
      algorithm: KDF_ALGORITHM,
      iterations: COFFER_BACKUP_KDF_ITERATIONS,
      salt: bytesToBase64Url(salt),
    },
  };

  const ciphertext = new Uint8Array(
    await webCrypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: copyToArrayBuffer(iv),
        additionalData: copyToArrayBuffer(protectedHeader(header)),
        tagLength: AES_GCM_TAG_LENGTH,
      },
      key,
      copyToArrayBuffer(plaintext),
    ),
  );
  const serialized = JSON.stringify({ ...header, ciphertext: bytesToBase64Url(ciphertext) }, null, 2);
  if (utf8Encoder.encode(serialized).byteLength > MAX_BACKUP_FILE_BYTES) {
    throw new Error(`Encrypted backup exceeds the ${MAX_BACKUP_FILE_BYTES}-byte size limit`);
  }
  return serialized;
}

/** Decrypts, parses, and strictly validates a password-protected Coffer backup. */
export async function decryptBackup(input: BackupInput, password: string): Promise<CofferAccount[]> {
  const envelope = validateEncryptedEnvelope(parseJson(input, MAX_BACKUP_FILE_BYTES));
  const passwordBytes = validatePassword(password);
  const salt = base64UrlToBytes(envelope.kdf.salt, "kdf.salt");
  const iv = base64UrlToBytes(envelope.encryption.iv, "encryption.iv");
  const ciphertext = base64UrlToBytes(envelope.ciphertext, "ciphertext");
  const key = await deriveBackupKey(passwordBytes, salt, "decrypt");
  const header: Omit<EncryptedBackupEnvelope, "ciphertext"> = {
    format: envelope.format,
    version: envelope.version,
    kind: envelope.kind,
    contentType: envelope.contentType,
    encryption: envelope.encryption,
    kdf: envelope.kdf,
  };

  let plaintext: ArrayBuffer;
  try {
    plaintext = await cryptoApi().subtle.decrypt(
      {
        name: "AES-GCM",
        iv: copyToArrayBuffer(iv),
        additionalData: copyToArrayBuffer(protectedHeader(header)),
        tagLength: AES_GCM_TAG_LENGTH,
      },
      key,
      copyToArrayBuffer(ciphertext),
    );
  } catch {
    throw new Error("Unable to decrypt backup. The password may be incorrect or the file may be damaged.");
  }

  if (plaintext.byteLength > MAX_BACKUP_PLAINTEXT_BYTES) {
    throw new Error(`Plain backup exceeds the ${MAX_BACKUP_PLAINTEXT_BYTES}-byte size limit`);
  }
  return parsePlainBackup(plaintext);
}
