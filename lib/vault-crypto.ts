import { argon2id } from "hash-wasm";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });

const VAULT_ID_BYTES = 16;
const SALT_BYTES = 16;
const AES_KEY_BYTES = 32;
const AUTH_KEY_BYTES = 32;
const DERIVED_KEY_BYTES = AES_KEY_BYTES + AUTH_KEY_BYTES;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const HMAC_BYTES = 32;
const RESUME_WRAPPING_KEY_BYTES = 32;
const RESUME_TAB_TOKEN_BYTES = 32;
const RESUME_KEY_BUNDLE_BYTES = AES_KEY_BYTES + AUTH_KEY_BYTES;
const RESUME_CIPHERTEXT_BYTES = RESUME_KEY_BUNDLE_BYTES + GCM_TAG_BYTES;

const WRAP_AAD_CONTEXT = "coffer:vault-key-wrap:v1";
const PAYLOAD_AAD_CONTEXT = "coffer:vault-payload:v1";
const PASSWORD_VERIFIER_CONTEXT = "coffer:password-verifier:v1";
const API_AUTH_PROOF_CONTEXT = "coffer:api-auth-proof:v1";
const RESUME_ENVELOPE_AAD_CONTEXT = "coffer:vault-resume-key-envelope:v1";

const MAX_PASSWORD_BYTES = 1_024;
const MIN_PASSWORD_CHARACTERS = 12;
export const MAX_VAULT_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const DEFAULT_VAULT_RESUME_AGE_MS = 12 * 60 * 60 * 1_000;
export const REMEMBERED_VAULT_RESUME_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
export const MAX_VAULT_RESUME_AGE_MS = REMEMBERED_VAULT_RESUME_AGE_MS;

const KDF_LIMITS = {
  minimumMemoryKiB: 19 * 1024,
  maximumMemoryKiB: 256 * 1024,
  minimumIterations: 2,
  maximumIterations: 10,
  minimumParallelism: 1,
  maximumParallelism: 4,
} as const;

export const DEFAULT_VAULT_KDF = {
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
} as const satisfies VaultKdfOptions;

export type VaultCryptoErrorCode =
  | "INVALID_INPUT"
  | "UNSUPPORTED_VAULT"
  | "AUTHENTICATION_FAILED"
  | "CORRUPT_VAULT"
  | "CRYPTO_UNAVAILABLE";

export class VaultCryptoError extends Error {
  readonly code: VaultCryptoErrorCode;

  constructor(code: VaultCryptoErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VaultCryptoError";
    this.code = code;
  }
}

export interface VaultKdfOptions {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

export interface VaultKdfParams extends VaultKdfOptions {
  algorithm: "argon2id";
  salt: string;
  hashLength: 64;
}

export interface PasswordVerifier {
  algorithm: "HMAC-SHA-256";
  value: string;
}

export interface WrappedVaultKey {
  algorithm: "AES-256-GCM";
  iv: string;
  ciphertext: string;
  tagLength: 128;
}

export interface EncryptedVaultHeader {
  format: "coffer-vault";
  version: 1;
  vaultId: string;
  createdAt: string;
  kdf: VaultKdfParams;
  passwordVerifier: PasswordVerifier;
  wrappedKey: WrappedVaultKey;
}

export interface VaultPayloadCipher {
  algorithm: "AES-256-GCM";
  iv: string;
  ciphertext: string;
  tagLength: 128;
}

/**
 * Runtime key handles are non-extractable and remain in browser memory only.
 * Same-tab resume persists only an AES-GCM ciphertext envelope; it never clones
 * these handles or writes the raw Vault Key/authentication-key bundle to storage.
 */
export interface VaultRuntime {
  readonly vaultKey: CryptoKey;
  readonly authKey: CryptoKey;
}

export interface VaultResumeKeyEnvelope {
  readonly format: "coffer-vault-resume-key-envelope";
  readonly version: 1;
  readonly vaultId: string;
  readonly tabToken: string;
  readonly createdAt: number;
  readonly absoluteExpiresAt: number;
  readonly algorithm: "AES-256-GCM";
  readonly iv: string;
  readonly ciphertext: string;
  readonly tagLength: 128;
}

/**
 * Transient handoff consumed by the browser resume store. The envelope contains
 * only authenticated ciphertext; the capability is never written to IndexedDB.
 */
export interface VaultResumeSealingMaterial {
  readonly envelope: VaultResumeKeyEnvelope;
  readonly wrappingSecret: string;
}

const VAULT_RESUME_MATERIALS = new WeakMap<VaultRuntime, VaultResumeSealingMaterial>();

export interface CreateEncryptedVaultOptions {
  /** Overrides are primarily useful for constrained clients and fast tests. */
  kdf?: Partial<VaultKdfOptions>;
  resumeTtlMs?: number;
}

export interface CreatedEncryptedVault {
  header: EncryptedVaultHeader;
  payloadCipher: VaultPayloadCipher;
  runtime: VaultRuntime;
}

export interface RotatedVaultPassword {
  header: EncryptedVaultHeader;
  runtime: VaultRuntime;
  currentAuthProof: string;
  nextAuthProof: string;
}

export interface UnlockedEncryptedVault<T> {
  payload: T;
  runtime: VaultRuntime;
}

function cryptoApi(): Crypto {
  const api = globalThis.crypto;

  if (!api?.subtle || typeof api.getRandomValues !== "function") {
    throw new VaultCryptoError(
      "CRYPTO_UNAVAILABLE",
      "A secure Web Crypto implementation is required.",
    );
  }

  return api;
}

function randomBytes(length: number): Uint8Array {
  return cryptoApi().getRandomValues(new Uint8Array(length));
}

function webCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes as Uint8Array<ArrayBuffer>;
  }
  return new Uint8Array(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }

  return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

const CANONICAL_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function base64ToBytes(value: unknown, field: string, maximumBytes: number): Uint8Array {
  if (typeof value !== "string" || value.length === 0) {
    throw new VaultCryptoError("INVALID_INPUT", `${field} must be a base64 string.`);
  }

  const maximumCharacters = Math.ceil(maximumBytes / 3) * 4;
  if (value.length > maximumCharacters || !CANONICAL_BASE64.test(value)) {
    throw new VaultCryptoError("INVALID_INPUT", `${field} is not canonical base64.`);
  }

  let binary: string;
  try {
    binary = atob(value);
  } catch (error) {
    throw new VaultCryptoError("INVALID_INPUT", `${field} is not valid base64.`, {
      cause: error,
    });
  }

  if (binary.length > maximumBytes) {
    throw new VaultCryptoError("INVALID_INPUT", `${field} exceeds its size limit.`);
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  if (bytesToBase64(bytes) !== value) {
    bytes.fill(0);
    throw new VaultCryptoError("INVALID_INPUT", `${field} is not canonical base64.`);
  }

  return bytes;
}

function decodeExactBase64(
  value: unknown,
  field: string,
  expectedBytes: number,
): Uint8Array {
  const bytes = base64ToBytes(value, field, expectedBytes);
  if (bytes.length !== expectedBytes) {
    bytes.fill(0);
    throw new VaultCryptoError(
      "INVALID_INPUT",
      `${field} must decode to exactly ${expectedBytes} bytes.`,
    );
  }
  return bytes;
}

function decodeExactBase64Url(
  value: unknown,
  field: string,
  expectedBytes: number,
): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length !== Math.ceil((expectedBytes * 8) / 6) ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new VaultCryptoError("INVALID_INPUT", `${field} is not canonical base64url.`);
  }
  const base64 = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = decodeExactBase64(base64, field, expectedBytes);
  if (bytesToBase64Url(bytes) !== value) {
    bytes.fill(0);
    throw new VaultCryptoError("INVALID_INPUT", `${field} is not canonical base64url.`);
  }
  return bytes;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactObjectKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function resolveVaultResumeAgeMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_VAULT_RESUME_AGE_MS;
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_VAULT_RESUME_AGE_MS) {
    throw new VaultCryptoError("INVALID_INPUT", "Vault resume duration is invalid.");
  }
  return value;
}

const RESUME_ENVELOPE_KEYS = [
  "format",
  "version",
  "vaultId",
  "tabToken",
  "createdAt",
  "absoluteExpiresAt",
  "algorithm",
  "iv",
  "ciphertext",
  "tagLength",
] as const;

function validateVaultResumeKeyEnvelope(
  value: unknown,
): asserts value is VaultResumeKeyEnvelope {
  if (
    !isPlainRecord(value) ||
    !hasExactObjectKeys(value, RESUME_ENVELOPE_KEYS) ||
    value.format !== "coffer-vault-resume-key-envelope" ||
    value.version !== 1 ||
    value.algorithm !== "AES-256-GCM" ||
    value.tagLength !== 128 ||
    !Number.isSafeInteger(value.createdAt) ||
    (value.createdAt as number) < 0 ||
    !Number.isSafeInteger(value.absoluteExpiresAt) ||
    (value.absoluteExpiresAt as number) - (value.createdAt as number) <= 0 ||
    (value.absoluteExpiresAt as number) - (value.createdAt as number) > MAX_VAULT_RESUME_AGE_MS
  ) {
    throw new VaultCryptoError("INVALID_INPUT", "Vault resume envelope metadata is invalid.");
  }

  decodeExactBase64(value.vaultId, "resumeEnvelope.vaultId", VAULT_ID_BYTES).fill(0);
  decodeExactBase64Url(
    value.tabToken,
    "resumeEnvelope.tabToken",
    RESUME_TAB_TOKEN_BYTES,
  ).fill(0);
  decodeExactBase64(value.iv, "resumeEnvelope.iv", GCM_IV_BYTES).fill(0);
  decodeExactBase64(
    value.ciphertext,
    "resumeEnvelope.ciphertext",
    RESUME_CIPHERTEXT_BYTES,
  ).fill(0);
}

export function isVaultResumeKeyEnvelope(
  value: unknown,
): value is VaultResumeKeyEnvelope {
  try {
    validateVaultResumeKeyEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

function resumeEnvelopeAdditionalData(
  envelope: Pick<
    VaultResumeKeyEnvelope,
    | "format"
    | "version"
    | "vaultId"
    | "tabToken"
    | "createdAt"
    | "absoluteExpiresAt"
    | "algorithm"
    | "tagLength"
  >,
): Uint8Array {
  return UTF8.encode(JSON.stringify({
    context: RESUME_ENVELOPE_AAD_CONTEXT,
    format: envelope.format,
    version: envelope.version,
    vaultId: envelope.vaultId,
    tabToken: envelope.tabToken,
    createdAt: envelope.createdAt,
    absoluteExpiresAt: envelope.absoluteExpiresAt,
    algorithm: envelope.algorithm,
    tagLength: envelope.tagLength,
  }));
}

function assertIntegerInRange(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new VaultCryptoError(
      "INVALID_INPUT",
      `${field} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
}

function validateKdfOptions(options: VaultKdfOptions): void {
  assertIntegerInRange(
    options.parallelism,
    "kdf.parallelism",
    KDF_LIMITS.minimumParallelism,
    KDF_LIMITS.maximumParallelism,
  );
  assertIntegerInRange(
    options.memoryKiB,
    "kdf.memoryKiB",
    Math.max(KDF_LIMITS.minimumMemoryKiB, options.parallelism * 8),
    KDF_LIMITS.maximumMemoryKiB,
  );
  assertIntegerInRange(
    options.iterations,
    "kdf.iterations",
    KDF_LIMITS.minimumIterations,
    KDF_LIMITS.maximumIterations,
  );
}

function resolveKdfOptions(overrides?: Partial<VaultKdfOptions>): VaultKdfOptions {
  const options: VaultKdfOptions = {
    memoryKiB: overrides?.memoryKiB ?? DEFAULT_VAULT_KDF.memoryKiB,
    iterations: overrides?.iterations ?? DEFAULT_VAULT_KDF.iterations,
    parallelism: overrides?.parallelism ?? DEFAULT_VAULT_KDF.parallelism,
  };
  validateKdfOptions(options);
  return options;
}

function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== "string") {
    throw new VaultCryptoError("INVALID_INPUT", "Password must be a string.");
  }

  const passwordLength = UTF8.encode(password).byteLength;
  const characterCount = Array.from(password).length;
  if (characterCount < MIN_PASSWORD_CHARACTERS || passwordLength > MAX_PASSWORD_BYTES) {
    throw new VaultCryptoError(
      "INVALID_INPUT",
      `Password must contain at least ${MIN_PASSWORD_CHARACTERS} characters and at most ${MAX_PASSWORD_BYTES} UTF-8 bytes.`,
    );
  }
}

async function deriveKeyMaterial(
  password: string,
  salt: Uint8Array,
  kdf: VaultKdfOptions,
): Promise<Uint8Array> {
  validatePassword(password);
  validateKdfOptions(kdf);

  const passwordBytes = UTF8.encode(password);
  try {
    return await argon2id({
      password: passwordBytes,
      salt,
      iterations: kdf.iterations,
      parallelism: kdf.parallelism,
      memorySize: kdf.memoryKiB,
      hashLength: DERIVED_KEY_BYTES,
      outputType: "binary",
    });
  } finally {
    passwordBytes.fill(0);
  }
}

async function importAesKey(
  bytes: Uint8Array,
  usages: readonly KeyUsage[],
): Promise<CryptoKey> {
  return cryptoApi().subtle.importKey(
    "raw",
    webCryptoBytes(bytes),
    { name: "AES-GCM", length: AES_KEY_BYTES * 8 },
    false,
    [...usages],
  );
}

async function importAuthKey(bytes: Uint8Array): Promise<CryptoKey> {
  return cryptoApi().subtle.importKey(
    "raw",
    webCryptoBytes(bytes),
    { name: "HMAC", hash: "SHA-256", length: AUTH_KEY_BYTES * 8 },
    false,
    ["sign"],
  );
}

function assertAesVaultKey(key: CryptoKey): void {
  if (
    key.type !== "secret" ||
    key.algorithm.name !== "AES-GCM" ||
    !key.usages.includes("encrypt") ||
    !key.usages.includes("decrypt")
  ) {
    throw new VaultCryptoError(
      "INVALID_INPUT",
      "vaultKey must be a non-extractable AES-GCM CryptoKey with encrypt and decrypt usage.",
    );
  }
}

function assertAuthKey(key: CryptoKey): void {
  if (
    key.type !== "secret" ||
    key.algorithm.name !== "HMAC" ||
    !key.usages.includes("sign")
  ) {
    throw new VaultCryptoError(
      "INVALID_INPUT",
      "authKey must be an HMAC CryptoKey with sign usage.",
    );
  }
}

async function attachVaultResumeSealingMaterial(
  runtime: VaultRuntime,
  vaultId: string,
  rawVaultKey: Uint8Array,
  rawAuthKey: Uint8Array,
  resumeTtlMs?: number,
): Promise<void> {
  decodeExactBase64(vaultId, "resumeEnvelope.vaultId", VAULT_ID_BYTES).fill(0);
  if (
    rawVaultKey.byteLength !== AES_KEY_BYTES ||
    rawAuthKey.byteLength !== AUTH_KEY_BYTES
  ) {
    throw new VaultCryptoError("INVALID_INPUT", "Vault resume key material is invalid.");
  }

  const wrappingSecret = randomBytes(RESUME_WRAPPING_KEY_BYTES);
  const tabTokenBytes = randomBytes(RESUME_TAB_TOKEN_BYTES);
  const iv = randomBytes(GCM_IV_BYTES);
  const bundle = new Uint8Array(RESUME_KEY_BUNDLE_BYTES);
  bundle.set(rawVaultKey, 0);
  bundle.set(rawAuthKey, AES_KEY_BYTES);
  let ciphertext: Uint8Array | undefined;

  try {
    const createdAt = Date.now();
    const resumeAgeMs = resolveVaultResumeAgeMs(resumeTtlMs);
    const metadata = {
      format: "coffer-vault-resume-key-envelope",
      version: 1,
      vaultId,
      tabToken: bytesToBase64Url(tabTokenBytes),
      createdAt,
      absoluteExpiresAt: createdAt + resumeAgeMs,
      algorithm: "AES-256-GCM",
      tagLength: 128,
    } as const;
    const wrappingKey = await importAesKey(wrappingSecret, ["encrypt"]);
    ciphertext = new Uint8Array(await cryptoApi().subtle.encrypt(
      {
        name: "AES-GCM",
        iv: webCryptoBytes(iv),
        additionalData: webCryptoBytes(resumeEnvelopeAdditionalData(metadata)),
        tagLength: 128,
      },
      wrappingKey,
      webCryptoBytes(bundle),
    ));
    if (ciphertext.byteLength !== RESUME_CIPHERTEXT_BYTES) {
      throw new VaultCryptoError("CRYPTO_UNAVAILABLE", "Vault resume sealing failed.");
    }

    const envelope: VaultResumeKeyEnvelope = {
      ...metadata,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
    };
    validateVaultResumeKeyEnvelope(envelope);
    VAULT_RESUME_MATERIALS.set(runtime, {
      envelope,
      wrappingSecret: bytesToBase64Url(wrappingSecret),
    });
  } finally {
    wrappingSecret.fill(0);
    tabTokenBytes.fill(0);
    iv.fill(0);
    bundle.fill(0);
    ciphertext?.fill(0);
  }
}

export function getVaultResumeSealingMaterial(
  runtime: VaultRuntime,
): VaultResumeSealingMaterial | null {
  const material = VAULT_RESUME_MATERIALS.get(runtime);
  if (!material) return null;
  return {
    envelope: { ...material.envelope },
    wrappingSecret: material.wrappingSecret,
  };
}

export async function restoreVaultRuntimeFromResumeEnvelope(
  envelope: VaultResumeKeyEnvelope,
  wrappingSecretValue: string,
): Promise<VaultRuntime> {
  validateVaultResumeKeyEnvelope(envelope);
  const now = Date.now();
  if (envelope.createdAt > now || envelope.absoluteExpiresAt <= now) {
    throw new VaultCryptoError(
      "AUTHENTICATION_FAILED",
      "Vault resume material has expired or is not yet valid.",
    );
  }
  const wrappingSecret = decodeExactBase64Url(
    wrappingSecretValue,
    "resumeCapability.wrappingSecret",
    RESUME_WRAPPING_KEY_BYTES,
  );
  const iv = decodeExactBase64(envelope.iv, "resumeEnvelope.iv", GCM_IV_BYTES);
  const ciphertext = decodeExactBase64(
    envelope.ciphertext,
    "resumeEnvelope.ciphertext",
    RESUME_CIPHERTEXT_BYTES,
  );
  let bundle: Uint8Array | undefined;
  let rawVaultKey: Uint8Array | undefined;
  let rawAuthKey: Uint8Array | undefined;

  try {
    const wrappingKey = await importAesKey(wrappingSecret, ["decrypt"]);
    try {
      bundle = new Uint8Array(await cryptoApi().subtle.decrypt(
        {
          name: "AES-GCM",
          iv: webCryptoBytes(iv),
          additionalData: webCryptoBytes(resumeEnvelopeAdditionalData(envelope)),
          tagLength: 128,
        },
        wrappingKey,
        webCryptoBytes(ciphertext),
      ));
    } catch (error) {
      throw new VaultCryptoError(
        "AUTHENTICATION_FAILED",
        "Vault resume material authentication failed.",
        { cause: error },
      );
    }

    if (bundle.byteLength !== RESUME_KEY_BUNDLE_BYTES) {
      throw new VaultCryptoError("CORRUPT_VAULT", "Vault resume key material has an invalid length.");
    }
    rawVaultKey = bundle.slice(0, AES_KEY_BYTES);
    rawAuthKey = bundle.slice(AES_KEY_BYTES);
    const [vaultKey, authKey] = await Promise.all([
      importAesKey(rawVaultKey, ["encrypt", "decrypt"]),
      importAuthKey(rawAuthKey),
    ]);
    const runtime: VaultRuntime = { vaultKey, authKey };
    VAULT_RESUME_MATERIALS.set(runtime, {
      envelope: { ...envelope },
      wrappingSecret: wrappingSecretValue,
    });
    return runtime;
  } finally {
    wrappingSecret.fill(0);
    iv.fill(0);
    ciphertext.fill(0);
    bundle?.fill(0);
    rawVaultKey?.fill(0);
    rawAuthKey?.fill(0);
  }
}

async function hmacContext(key: CryptoKey, context: string): Promise<Uint8Array> {
  assertAuthKey(key);
  const signature = await cryptoApi().subtle.sign(
    "HMAC",
    key,
    webCryptoBytes(UTF8.encode(context)),
  );
  return new Uint8Array(signature);
}

/** A local wrong-password check. This value is public and is not an API credential. */
export async function passwordVerifier(authKey: CryptoKey): Promise<string> {
  const signature = await hmacContext(authKey, PASSWORD_VERIFIER_CONTEXT);
  try {
    return bytesToBase64(signature);
  } finally {
    signature.fill(0);
  }
}

/**
 * Deterministic bearer proof for TLS-protected API authentication. The server
 * should persist only SHA-256(proof), never this proof or the auth key itself.
 */
export async function createAuthProof(authKey: CryptoKey): Promise<string> {
  const signature = await hmacContext(authKey, API_AUTH_PROOF_CONTEXT);
  try {
    return bytesToBase64Url(signature);
  } finally {
    signature.fill(0);
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

function wrapAdditionalData(header: EncryptedVaultHeader): Uint8Array {
  return UTF8.encode(
    JSON.stringify({
      context: WRAP_AAD_CONTEXT,
      format: header.format,
      version: header.version,
      vaultId: header.vaultId,
      createdAt: header.createdAt,
      kdf: header.kdf,
      passwordVerifier: header.passwordVerifier,
    }),
  );
}

function serializePayload(payload: unknown): Uint8Array {
  let json: string | undefined;
  try {
    json = JSON.stringify(payload);
  } catch (error) {
    throw new VaultCryptoError("INVALID_INPUT", "Vault payload must be valid JSON.", {
      cause: error,
    });
  }

  if (json === undefined) {
    throw new VaultCryptoError("INVALID_INPUT", "Vault payload must be valid JSON.");
  }

  const bytes = UTF8.encode(json);
  if (bytes.byteLength > MAX_VAULT_PAYLOAD_BYTES) {
    throw new VaultCryptoError(
      "INVALID_INPUT",
      `Vault payload exceeds ${MAX_VAULT_PAYLOAD_BYTES} bytes.`,
    );
  }
  return bytes;
}

function validateHeader(header: EncryptedVaultHeader): void {
  if (!header || typeof header !== "object") {
    throw new VaultCryptoError("INVALID_INPUT", "Vault header must be an object.");
  }
  if (header.format !== "coffer-vault" || header.version !== 1) {
    throw new VaultCryptoError("UNSUPPORTED_VAULT", "Unsupported vault format or version.");
  }
  if (
    typeof header.createdAt !== "string" ||
    header.createdAt.length > 64 ||
    !Number.isFinite(Date.parse(header.createdAt))
  ) {
    throw new VaultCryptoError("INVALID_INPUT", "header.createdAt must be an ISO date string.");
  }

  decodeExactBase64(header.vaultId, "header.vaultId", VAULT_ID_BYTES).fill(0);

  if (
    !header.kdf ||
    header.kdf.algorithm !== "argon2id" ||
    header.kdf.hashLength !== DERIVED_KEY_BYTES
  ) {
    throw new VaultCryptoError("UNSUPPORTED_VAULT", "Unsupported vault KDF.");
  }
  validateKdfOptions(header.kdf);
  decodeExactBase64(header.kdf.salt, "header.kdf.salt", SALT_BYTES).fill(0);

  if (!header.passwordVerifier || header.passwordVerifier.algorithm !== "HMAC-SHA-256") {
    throw new VaultCryptoError("UNSUPPORTED_VAULT", "Unsupported password verifier.");
  }
  decodeExactBase64(
    header.passwordVerifier.value,
    "header.passwordVerifier.value",
    HMAC_BYTES,
  ).fill(0);

  if (
    !header.wrappedKey ||
    header.wrappedKey.algorithm !== "AES-256-GCM" ||
    header.wrappedKey.tagLength !== 128
  ) {
    throw new VaultCryptoError("UNSUPPORTED_VAULT", "Unsupported wrapped-key cipher.");
  }
  decodeExactBase64(header.wrappedKey.iv, "header.wrappedKey.iv", GCM_IV_BYTES).fill(0);
  decodeExactBase64(
    header.wrappedKey.ciphertext,
    "header.wrappedKey.ciphertext",
    AES_KEY_BYTES + GCM_TAG_BYTES,
  ).fill(0);
}

function decodePayloadCipher(payloadCipher: VaultPayloadCipher): {
  iv: Uint8Array;
  ciphertext: Uint8Array;
} {
  if (!payloadCipher || typeof payloadCipher !== "object") {
    throw new VaultCryptoError("INVALID_INPUT", "Encrypted payload must be an object.");
  }
  if (
    payloadCipher.algorithm !== "AES-256-GCM" ||
    payloadCipher.tagLength !== 128
  ) {
    throw new VaultCryptoError("UNSUPPORTED_VAULT", "Unsupported payload cipher.");
  }

  const iv = decodeExactBase64(payloadCipher.iv, "payloadCipher.iv", GCM_IV_BYTES);
  const ciphertext = base64ToBytes(
    payloadCipher.ciphertext,
    "payloadCipher.ciphertext",
    MAX_VAULT_PAYLOAD_BYTES + GCM_TAG_BYTES,
  );

  if (ciphertext.byteLength < GCM_TAG_BYTES) {
    iv.fill(0);
    ciphertext.fill(0);
    throw new VaultCryptoError("INVALID_INPUT", "Encrypted payload is shorter than its GCM tag.");
  }

  return { iv, ciphertext };
}

export async function encryptVaultPayload<T>(
  payload: T,
  vaultKey: CryptoKey,
): Promise<VaultPayloadCipher> {
  assertAesVaultKey(vaultKey);
  const plaintext = serializePayload(payload);
  const iv = randomBytes(GCM_IV_BYTES);

  try {
    const ciphertext = new Uint8Array(
      await cryptoApi().subtle.encrypt(
        {
          name: "AES-GCM",
          iv: webCryptoBytes(iv),
          additionalData: webCryptoBytes(UTF8.encode(PAYLOAD_AAD_CONTEXT)),
          tagLength: 128,
        },
        vaultKey,
        webCryptoBytes(plaintext),
      ),
    );

    try {
      return {
        algorithm: "AES-256-GCM",
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(ciphertext),
        tagLength: 128,
      };
    } finally {
      ciphertext.fill(0);
    }
  } finally {
    plaintext.fill(0);
    iv.fill(0);
  }
}

export async function decryptVaultPayload<T>(
  payloadCipher: VaultPayloadCipher,
  vaultKey: CryptoKey,
): Promise<T> {
  assertAesVaultKey(vaultKey);
  const { iv, ciphertext } = decodePayloadCipher(payloadCipher);
  let plaintext: Uint8Array | undefined;

  try {
    try {
      plaintext = new Uint8Array(
        await cryptoApi().subtle.decrypt(
          {
            name: "AES-GCM",
            iv: webCryptoBytes(iv),
            additionalData: webCryptoBytes(UTF8.encode(PAYLOAD_AAD_CONTEXT)),
            tagLength: 128,
          },
          vaultKey,
          webCryptoBytes(ciphertext),
        ),
      );
    } catch (error) {
      throw new VaultCryptoError(
        "CORRUPT_VAULT",
        "Vault payload authentication failed.",
        { cause: error },
      );
    }

    if (plaintext.byteLength > MAX_VAULT_PAYLOAD_BYTES) {
      throw new VaultCryptoError("CORRUPT_VAULT", "Decrypted vault payload exceeds its size limit.");
    }

    let json: string;
    try {
      json = UTF8_FATAL.decode(plaintext);
    } catch (error) {
      throw new VaultCryptoError("CORRUPT_VAULT", "Vault payload is not valid UTF-8.", {
        cause: error,
      });
    }

    try {
      return JSON.parse(json) as T;
    } catch (error) {
      throw new VaultCryptoError("CORRUPT_VAULT", "Vault payload is not valid JSON.", {
        cause: error,
      });
    }
  } finally {
    plaintext?.fill(0);
    ciphertext.fill(0);
    iv.fill(0);
  }
}

export async function createEncryptedVault<T>(
  password: string,
  payload: T,
  options: CreateEncryptedVaultOptions = {},
): Promise<CreatedEncryptedVault> {
  validatePassword(password);
  const kdfOptions = resolveKdfOptions(options.kdf);
  const salt = randomBytes(SALT_BYTES);
  const vaultId = randomBytes(VAULT_ID_BYTES);
  const rawVaultKey = randomBytes(AES_KEY_BYTES);
  let derived: Uint8Array | undefined;
  let kekBytes: Uint8Array | undefined;
  let authKeyBytes: Uint8Array | undefined;

  try {
    derived = await deriveKeyMaterial(password, salt, kdfOptions);
    kekBytes = derived.slice(0, AES_KEY_BYTES);
    authKeyBytes = derived.slice(AES_KEY_BYTES);

    const [kek, vaultKey, authKey] = await Promise.all([
      importAesKey(kekBytes, ["encrypt", "decrypt"]),
      importAesKey(rawVaultKey, ["encrypt", "decrypt"]),
      importAuthKey(authKeyBytes),
    ]);

    const header: EncryptedVaultHeader = {
      format: "coffer-vault",
      version: 1,
      vaultId: bytesToBase64(vaultId),
      createdAt: new Date().toISOString(),
      kdf: {
        algorithm: "argon2id",
        salt: bytesToBase64(salt),
        memoryKiB: kdfOptions.memoryKiB,
        iterations: kdfOptions.iterations,
        parallelism: kdfOptions.parallelism,
        hashLength: 64,
      },
      passwordVerifier: {
        algorithm: "HMAC-SHA-256",
        value: await passwordVerifier(authKey),
      },
      wrappedKey: {
        algorithm: "AES-256-GCM",
        iv: "",
        ciphertext: "",
        tagLength: 128,
      },
    };

    const wrapIv = randomBytes(GCM_IV_BYTES);
    try {
      const wrappedKey = new Uint8Array(
        await cryptoApi().subtle.encrypt(
          {
            name: "AES-GCM",
            iv: webCryptoBytes(wrapIv),
            additionalData: webCryptoBytes(wrapAdditionalData(header)),
            tagLength: 128,
          },
          kek,
          webCryptoBytes(rawVaultKey),
        ),
      );

      try {
        header.wrappedKey = {
          algorithm: "AES-256-GCM",
          iv: bytesToBase64(wrapIv),
          ciphertext: bytesToBase64(wrappedKey),
          tagLength: 128,
        };
      } finally {
        wrappedKey.fill(0);
      }
    } finally {
      wrapIv.fill(0);
    }

    const runtime: VaultRuntime = { vaultKey, authKey };
    await attachVaultResumeSealingMaterial(
      runtime,
      header.vaultId,
      rawVaultKey,
      authKeyBytes,
      options.resumeTtlMs,
    );
    const payloadCipher = await encryptVaultPayload(payload, vaultKey);
    return { header, payloadCipher, runtime };
  } finally {
    salt.fill(0);
    vaultId.fill(0);
    rawVaultKey.fill(0);
    derived?.fill(0);
    kekBytes?.fill(0);
    authKeyBytes?.fill(0);
  }
}

type UnwrappedVaultKeyMaterial = {
  rawVaultKey: Uint8Array;
  rawAuthKey: Uint8Array;
  authKey: CryptoKey;
};

async function unwrapVaultKeyMaterial(
  password: string,
  header: EncryptedVaultHeader,
): Promise<UnwrappedVaultKeyMaterial> {
  validatePassword(password);
  validateHeader(header);

  const salt = decodeExactBase64(header.kdf.salt, "header.kdf.salt", SALT_BYTES);
  let derived: Uint8Array | undefined;
  let kekBytes: Uint8Array | undefined;
  let rawAuthKey: Uint8Array | undefined;
  let rawVaultKey: Uint8Array | undefined;
  let result: UnwrappedVaultKeyMaterial | undefined;

  try {
    derived = await deriveKeyMaterial(password, salt, header.kdf);
    kekBytes = derived.slice(0, AES_KEY_BYTES);
    rawAuthKey = derived.slice(AES_KEY_BYTES);

    const authKey = await importAuthKey(rawAuthKey);
    const actualVerifier = decodeExactBase64(
      await passwordVerifier(authKey),
      "derived password verifier",
      HMAC_BYTES,
    );
    const expectedVerifier = decodeExactBase64(
      header.passwordVerifier.value,
      "header.passwordVerifier.value",
      HMAC_BYTES,
    );

    try {
      if (!constantTimeEqual(actualVerifier, expectedVerifier)) {
        throw new VaultCryptoError(
          "AUTHENTICATION_FAILED",
          "The password is incorrect or the vault header was modified.",
        );
      }
    } finally {
      actualVerifier.fill(0);
      expectedVerifier.fill(0);
    }

    const kek = await importAesKey(kekBytes, ["decrypt"]);
    const wrapIv = decodeExactBase64(
      header.wrappedKey.iv,
      "header.wrappedKey.iv",
      GCM_IV_BYTES,
    );
    const wrappedKey = decodeExactBase64(
      header.wrappedKey.ciphertext,
      "header.wrappedKey.ciphertext",
      AES_KEY_BYTES + GCM_TAG_BYTES,
    );

    try {
      try {
        rawVaultKey = new Uint8Array(
          await cryptoApi().subtle.decrypt(
            {
              name: "AES-GCM",
              iv: webCryptoBytes(wrapIv),
              additionalData: webCryptoBytes(wrapAdditionalData(header)),
              tagLength: 128,
            },
            kek,
            webCryptoBytes(wrappedKey),
          ),
        );
      } catch (error) {
        throw new VaultCryptoError(
          "AUTHENTICATION_FAILED",
          "The password is incorrect or the vault header was modified.",
          { cause: error },
        );
      }
    } finally {
      wrapIv.fill(0);
      wrappedKey.fill(0);
    }

    if (rawVaultKey.byteLength !== AES_KEY_BYTES) {
      throw new VaultCryptoError("CORRUPT_VAULT", "Wrapped vault key has an invalid length.");
    }
    result = { rawVaultKey, rawAuthKey, authKey };
    return result;
  } finally {
    salt.fill(0);
    derived?.fill(0);
    kekBytes?.fill(0);
    if (!result) {
      rawAuthKey?.fill(0);
      rawVaultKey?.fill(0);
    }
  }
}

/**
 * Unlocks only the small public header. Use this before API authentication;
 * fetch the encrypted payload only after authenticating with createAuthProof().
 */
export async function unlockVaultHeader(
  password: string,
  header: EncryptedVaultHeader,
  options: { resumeTtlMs?: number } = {},
): Promise<VaultRuntime> {
  const material = await unwrapVaultKeyMaterial(password, header);
  try {
    const vaultKey = await importAesKey(material.rawVaultKey, ["encrypt", "decrypt"]);
    const runtime: VaultRuntime = { vaultKey, authKey: material.authKey };
    await attachVaultResumeSealingMaterial(
      runtime,
      header.vaultId,
      material.rawVaultKey,
      material.rawAuthKey,
      options.resumeTtlMs,
    );
    return runtime;
  } finally {
    material.rawVaultKey.fill(0);
    material.rawAuthKey.fill(0);
  }
}

/**
 * Verifies the current password, then re-wraps the existing vault key with a
 * fresh salt and IV derived from the next password. The encrypted payload and
 * stable vault identity do not change.
 */
export async function rotateVaultPassword(
  currentPassword: string,
  nextPassword: string,
  header: EncryptedVaultHeader,
  options: { resumeTtlMs?: number } = {},
): Promise<RotatedVaultPassword> {
  validatePassword(nextPassword);
  if (currentPassword === nextPassword) {
    throw new VaultCryptoError("INVALID_INPUT", "The new password must be different from the current password.");
  }

  const current = await unwrapVaultKeyMaterial(currentPassword, header);
  let salt: Uint8Array | undefined;
  let wrapIv: Uint8Array | undefined;
  let derived: Uint8Array | undefined;
  let kekBytes: Uint8Array | undefined;
  let nextAuthKeyBytes: Uint8Array | undefined;
  let wrappedKey: Uint8Array | undefined;

  try {
    // The imported HMAC handle is sufficient for the current API proof. Keep
    // the raw current authentication key alive no longer than necessary.
    current.rawAuthKey.fill(0);
    const kdfOptions = resolveKdfOptions({
      memoryKiB: header.kdf.memoryKiB,
      iterations: header.kdf.iterations,
      parallelism: header.kdf.parallelism,
    });
    salt = randomBytes(SALT_BYTES);
    wrapIv = randomBytes(GCM_IV_BYTES);
    derived = await deriveKeyMaterial(nextPassword, salt, kdfOptions);
    kekBytes = derived.slice(0, AES_KEY_BYTES);
    nextAuthKeyBytes = derived.slice(AES_KEY_BYTES);
    const [kek, vaultKey, nextAuthKey] = await Promise.all([
      importAesKey(kekBytes, ["encrypt"]),
      importAesKey(current.rawVaultKey, ["encrypt", "decrypt"]),
      importAuthKey(nextAuthKeyBytes),
    ]);

    const nextHeader: EncryptedVaultHeader = {
      format: header.format,
      version: header.version,
      vaultId: header.vaultId,
      createdAt: header.createdAt,
      kdf: {
        algorithm: "argon2id",
        salt: bytesToBase64(salt),
        memoryKiB: kdfOptions.memoryKiB,
        iterations: kdfOptions.iterations,
        parallelism: kdfOptions.parallelism,
        hashLength: 64,
      },
      passwordVerifier: {
        algorithm: "HMAC-SHA-256",
        value: await passwordVerifier(nextAuthKey),
      },
      wrappedKey: {
        algorithm: "AES-256-GCM",
        iv: "",
        ciphertext: "",
        tagLength: 128,
      },
    };

    wrappedKey = new Uint8Array(await cryptoApi().subtle.encrypt(
      {
        name: "AES-GCM",
        iv: webCryptoBytes(wrapIv),
        additionalData: webCryptoBytes(wrapAdditionalData(nextHeader)),
        tagLength: 128,
      },
      kek,
      webCryptoBytes(current.rawVaultKey),
    ));
    nextHeader.wrappedKey = {
      algorithm: "AES-256-GCM",
      iv: bytesToBase64(wrapIv),
      ciphertext: bytesToBase64(wrappedKey),
      tagLength: 128,
    };
    validateHeader(nextHeader);

    const runtime: VaultRuntime = { vaultKey, authKey: nextAuthKey };
    await attachVaultResumeSealingMaterial(
      runtime,
      nextHeader.vaultId,
      current.rawVaultKey,
      nextAuthKeyBytes,
      options.resumeTtlMs,
    );
    const [currentAuthProof, nextAuthProof] = await Promise.all([
      createAuthProof(current.authKey),
      createAuthProof(nextAuthKey),
    ]);
    return { header: nextHeader, runtime, currentAuthProof, nextAuthProof };
  } finally {
    current.rawVaultKey.fill(0);
    current.rawAuthKey.fill(0);
    salt?.fill(0);
    wrapIv?.fill(0);
    derived?.fill(0);
    kekBytes?.fill(0);
    nextAuthKeyBytes?.fill(0);
    wrappedKey?.fill(0);
  }
}

export async function unlockEncryptedVault<T>(
  password: string,
  header: EncryptedVaultHeader,
  payloadCipher: VaultPayloadCipher,
): Promise<UnlockedEncryptedVault<T>> {
  const runtime = await unlockVaultHeader(password, header);
  const payload = await decryptVaultPayload<T>(payloadCipher, runtime.vaultKey);
  return { payload, runtime };
}
