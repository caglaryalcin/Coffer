import type { CofferAccount, CofferTotpAlgorithm } from "./backup";
import type { ImportBatch, ImportItem } from "./importers";
import { createOtpAuthUri, parseBase32Secret } from "./totp";

export const TWOFAS_SCHEMA_VERSION = 4 as const;
export const TWOFAS_BACKUP_KDF_ITERATIONS = 10_000 as const;
export const TWOFAS_REFERENCE =
  "tRViSsLKzd86Hprh4ceC2OP7xazn4rrt4xhfEUbOjxLX8Rc3mkISXE0lWbmnWfggogbBJhtYgpK6fMl1D6mtsy92R3HkdGfwuXbzLebqVFJsR7IZ2w58t938iymwG4824igYy1wi6n2WDpO1Q1P69zwJGs2F5a1qP4MyIiDSD7NCV2OvidXQCBnDlGfmz0f1BQySRkkt4ryiJeCjD2o4QsveJ9uDBUn8ELyOrESv5R5DMDkD4iAF8TXU7KyoJujd" as const;

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_PLAINTEXT_BYTES = 5 * 1024 * 1024;
const MAX_ACCOUNTS = 1_000;
const MAX_GROUPS = 1_000;
const MAX_PASSWORD_CHARACTERS = 1_024;
const MAX_SERVICE_CHARACTERS = 256;
const MAX_IDENTITY_CHARACTERS = 512;
const MAX_GROUP_CHARACTERS = 128;
const MAX_GROUP_ID_CHARACTERS = 128;
const AES_KEY_BITS = 256;
const AES_GCM_TAG_BYTES = 16;
const SALT_BYTES = 32;
const MIN_IMPORT_SALT_BYTES = 16;
const MAX_IMPORT_SALT_BYTES = 256;
const IV_BYTES = 12;
const DECRYPTION_ERROR = "Unable to decrypt 2FAS backup. The password may be incorrect or the file may be damaged.";

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

type JsonRecord = Record<string, unknown>;

type EncryptedValue = {
  ciphertext: Uint8Array;
  salt: Uint8Array;
  iv: Uint8Array;
};

type ValidatedEnvelope = {
  services: unknown[];
  groups: unknown[];
  servicesEncrypted?: EncryptedValue;
  reference?: EncryptedValue;
};

function cryptoApi(): Crypto {
  if (!globalThis.crypto?.subtle || !globalThis.crypto.getRandomValues) {
    throw new Error("Web Crypto is not available in this environment");
  }
  return globalThis.crypto;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function safeText(value: unknown, field: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim().length === 0 ||
    hasControlCharacters(value)
  ) {
    throw new Error(`${field} is missing or invalid`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, maximum: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return safeText(value, field, maximum);
}

function safePreview(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0 || hasControlCharacters(value)) return null;
  return value.trim().slice(0, 96);
}

function assertInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${field} is invalid`);
  }
  return value as number;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string, field: string, maximumBytes: number): Uint8Array {
  const maximumCharacters = Math.ceil(maximumBytes / 3) * 4;
  if (
    value.length === 0 ||
    value.length > maximumCharacters ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw new Error(`${field} must use canonical padded Base64`);
  }

  try {
    const binary = atob(value);
    if (binary.length > maximumBytes) throw new Error("decoded value is too large");
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    if (bytesToBase64(bytes) !== value) throw new Error("non-canonical Base64");
    return bytes;
  } catch {
    throw new Error(`${field} must use canonical padded Base64`);
  }
}

function parseEncryptedValue(value: unknown, field: string): EncryptedValue {
  if (typeof value !== "string" || value.length > Math.ceil((MAX_PLAINTEXT_BYTES + 256) / 3) * 4) {
    throw new Error(`${field} is invalid`);
  }
  const pieces = value.split(":");
  if (pieces.length !== 3) throw new Error(`${field} must contain ciphertext, salt, and IV`);

  const ciphertext = base64ToBytes(pieces[0], `${field} ciphertext`, MAX_PLAINTEXT_BYTES + AES_GCM_TAG_BYTES);
  const salt = base64ToBytes(pieces[1], `${field} salt`, MAX_IMPORT_SALT_BYTES);
  const iv = base64ToBytes(pieces[2], `${field} IV`, IV_BYTES);
  if (ciphertext.byteLength <= AES_GCM_TAG_BYTES) throw new Error(`${field} ciphertext is empty or truncated`);
  if (salt.byteLength < MIN_IMPORT_SALT_BYTES || salt.byteLength > MAX_IMPORT_SALT_BYTES) {
    throw new Error(`${field} salt must contain between ${MIN_IMPORT_SALT_BYTES} and ${MAX_IMPORT_SALT_BYTES} bytes`);
  }
  if (iv.byteLength !== IV_BYTES) throw new Error(`${field} IV must be ${IV_BYTES} bytes`);
  return { ciphertext, salt, iv };
}

function serializeEncryptedValue(ciphertext: Uint8Array, salt: Uint8Array, iv: Uint8Array): string {
  return `${bytesToBase64(ciphertext)}:${bytesToBase64(salt)}:${bytesToBase64(iv)}`;
}

function inputToJson(input: string): unknown {
  if (typeof input !== "string" || utf8Encoder.encode(input).byteLength > MAX_FILE_BYTES) {
    throw new Error("This file is larger than the 5 MiB 2FAS import limit");
  }
  try {
    return JSON.parse(input.replace(/^\uFEFF/u, "")) as unknown;
  } catch {
    throw new Error("This does not look like a valid 2FAS JSON backup");
  }
}

function validateTopLevelMetadata(value: JsonRecord): void {
  const required = ["services", "schemaVersion", "appVersionCode", "appVersionName", "appOrigin"];
  const allowed = new Set([...required, "groups", "updatedAt", "account", "servicesEncrypted", "reference"]);
  if (required.some((field) => !Object.hasOwn(value, field)) || Object.keys(value).some((field) => !allowed.has(field))) {
    throw new Error("The 2FAS backup contains missing or unsupported metadata");
  }
  const schemaVersion = assertInteger(value.schemaVersion, "schemaVersion", 1, TWOFAS_SCHEMA_VERSION);
  if (schemaVersion === TWOFAS_SCHEMA_VERSION && !Object.hasOwn(value, "groups")) {
    throw new Error("2FAS schema version 4 backups must include groups");
  }
  if (value.updatedAt !== undefined) assertInteger(value.updatedAt, "updatedAt", 0, Number.MAX_SAFE_INTEGER);
  assertInteger(value.appVersionCode, "appVersionCode", 0, Number.MAX_SAFE_INTEGER);
  safeText(value.appVersionName, "appVersionName", 128);
  const appOrigin = safeText(value.appOrigin, "appOrigin", 64);
  if (appOrigin !== "android" && appOrigin !== "ios") throw new Error("appOrigin must be android or ios");
  if (value.account !== undefined && value.account !== null) safeText(value.account, "account", 512);
}

function validateEnvelope(value: unknown): ValidatedEnvelope {
  if (!isRecord(value)) throw new Error("This does not look like a 2FAS backup");
  validateTopLevelMetadata(value);
  const rawGroups = value.groups ?? [];
  if (!Array.isArray(value.services) || !Array.isArray(rawGroups)) {
    throw new Error("2FAS services and groups must be arrays");
  }
  if (value.services.length > MAX_ACCOUNTS) throw new Error("This 2FAS backup contains more than 1,000 accounts");
  if (rawGroups.length > MAX_GROUPS) throw new Error("This 2FAS backup contains more than 1,000 groups");

  const hasEncryptedServices = value.servicesEncrypted !== undefined && value.servicesEncrypted !== null;
  const hasReference = value.reference !== undefined && value.reference !== null;
  if (hasEncryptedServices !== hasReference) {
    throw new Error("Encrypted 2FAS backups must include both servicesEncrypted and reference");
  }
  if (!hasEncryptedServices) return { services: value.services, groups: rawGroups };
  if (value.services.length !== 0) throw new Error("Encrypted 2FAS backups must not also contain plaintext services");

  const servicesEncrypted = parseEncryptedValue(value.servicesEncrypted, "servicesEncrypted");
  const reference = parseEncryptedValue(value.reference, "reference");
  if (!bytesEqual(servicesEncrypted.salt, reference.salt)) {
    throw new Error("Encrypted 2FAS fields must use the same salt");
  }
  if (bytesEqual(servicesEncrypted.iv, reference.iv)) {
    throw new Error("Encrypted 2FAS fields must use different IVs");
  }
  return { services: [], groups: rawGroups, servicesEncrypted, reference };
}

function passwordToBytes(password: string): Uint8Array {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error("Password must not be empty");
  }
  const passwordBytes = utf8Encoder.encode(password);
  if (passwordBytes.byteLength > MAX_PASSWORD_CHARACTERS) {
    passwordBytes.fill(0);
    throw new Error(`Password must not exceed ${MAX_PASSWORD_CHARACTERS} UTF-8 bytes`);
  }
  return passwordBytes;
}

function validateExportPassword(password: string): void {
  const passwordBytes = passwordToBytes(password);
  try {
    if (password.length < 12 || !/^[\x20-\x7E]+$/u.test(password)) {
      throw new Error("2FAS export passwords must contain 12 to 1,024 printable ASCII characters");
    }
  } finally {
    passwordBytes.fill(0);
  }
}

async function deriveKey(password: string, salt: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  const passwordBytes = passwordToBytes(password);
  try {
    const keyMaterial = await cryptoApi().subtle.importKey(
      "raw",
      copyToArrayBuffer(passwordBytes),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return cryptoApi().subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: TWOFAS_BACKUP_KDF_ITERATIONS,
        salt: copyToArrayBuffer(salt),
      },
      keyMaterial,
      { name: "AES-GCM", length: AES_KEY_BITS },
      false,
      [usage],
    );
  } finally {
    passwordBytes.fill(0);
  }
}

async function decryptValue(value: EncryptedValue, key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(
    await cryptoApi().subtle.decrypt(
      { name: "AES-GCM", iv: copyToArrayBuffer(value.iv), tagLength: AES_GCM_TAG_BYTES * 8 },
      key,
      copyToArrayBuffer(value.ciphertext),
    ),
  );
}

async function decryptServices(envelope: ValidatedEnvelope, password: string | undefined): Promise<unknown[]> {
  if (!envelope.servicesEncrypted || !envelope.reference) return envelope.services;
  if (password === undefined || password.length === 0) throw new Error("This 2FAS backup is password-protected");

  let referencePlaintext: Uint8Array | undefined;
  let servicesPlaintext: Uint8Array | undefined;
  try {
    const key = await deriveKey(password, envelope.servicesEncrypted.salt, "decrypt");
    referencePlaintext = await decryptValue(envelope.reference, key);
    if (!bytesEqual(referencePlaintext, utf8Encoder.encode(TWOFAS_REFERENCE))) throw new Error(DECRYPTION_ERROR);
    servicesPlaintext = await decryptValue(envelope.servicesEncrypted, key);
  } catch {
    throw new Error(DECRYPTION_ERROR);
  }

  if (servicesPlaintext.byteLength > MAX_PLAINTEXT_BYTES) {
    servicesPlaintext.fill(0);
    throw new Error("Decrypted 2FAS services exceed the 5 MiB limit");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decoder.decode(servicesPlaintext)) as unknown;
  } catch {
    throw new Error("Decrypted 2FAS services are not valid UTF-8 JSON");
  } finally {
    referencePlaintext.fill(0);
    servicesPlaintext.fill(0);
  }
  if (!Array.isArray(parsed)) throw new Error("Decrypted 2FAS services must be an array");
  if (parsed.length > MAX_ACCOUNTS) throw new Error("This 2FAS backup contains more than 1,000 accounts");
  return parsed;
}

function parseGroups(value: unknown[]): Map<string, string> {
  const groups = new Map<string, string>();
  value.forEach((entry, index) => {
    if (!isRecord(entry)) throw new Error(`groups[${index}] must be an object`);
    const id = safeText(entry.id, `groups[${index}].id`, MAX_GROUP_ID_CHARACTERS);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)) {
      throw new Error(`groups[${index}].id must be a UUID`);
    }
    const name = safeText(entry.name, `groups[${index}].name`, MAX_GROUP_CHARACTERS);
    if (groups.has(id)) throw new Error(`groups[${index}].id is duplicated`);
    if (typeof entry.isExpanded !== "boolean") throw new Error(`groups[${index}].isExpanded must be a boolean`);
    if (entry.updatedAt !== undefined) {
      assertInteger(entry.updatedAt, `groups[${index}].updatedAt`, 0, Number.MAX_SAFE_INTEGER);
    }
    groups.set(id, name);
  });
  return groups;
}

function parseAlgorithm(value: unknown): CofferTotpAlgorithm {
  if (value === undefined || value === null) return "SHA-1";
  if (typeof value !== "string" || !/^[A-Za-z0-9-]+$/u.test(value)) throw new Error("Algorithm is invalid");
  const normalized = value.toUpperCase().replace(/-/gu, "");
  if (normalized === "SHA1") return "SHA-1";
  if (normalized === "SHA256") return "SHA-256";
  if (normalized === "SHA512") return "SHA-512";
  throw new Error("Algorithm is not supported");
}

function parseService(
  entry: unknown,
  index: number,
  groups: ReadonlyMap<string, string>,
): CofferAccount {
  if (!isRecord(entry)) throw new Error("Account entry is not an object");
  const field = `services[${index}]`;
  const fallbackService = safeText(entry.name, `${field}.name`, MAX_SERVICE_CHARACTERS);
  if (typeof entry.secret !== "string") throw new Error("Secret is not valid Base32");
  const secret = parseBase32Secret(entry.secret);
  if (!isRecord(entry.otp)) throw new Error("OTP settings are missing");

  const tokenType = optionalText(entry.otp.tokenType, `${field}.otp.tokenType`, 32);
  const link = optionalText(entry.otp.link, `${field}.otp.link`, 8_192);
  if (tokenType === null && link?.toLowerCase().startsWith("otpauth://hotp/")) {
    throw new Error("HOTP accounts are not supported");
  }
  const normalizedType = tokenType?.toUpperCase() ?? "TOTP";
  if (normalizedType === "HOTP") throw new Error("HOTP accounts are not supported");
  if (normalizedType === "STEAM") throw new Error("Steam accounts are not supported");
  if (normalizedType !== "TOTP") throw new Error(`${normalizedType} accounts are not supported`);
  // 2FAS treats tokenType as authoritative and defaults a missing value to
  // TOTP. Some official backups retain a counter on those TOTP records, so it
  // must not be used to infer HOTP. An explicit HOTP type or HOTP URI is still
  // rejected above because Coffer does not model counter-based tokens.

  const rawDigits = entry.otp.digits ?? 6;
  if (rawDigits !== 6 && rawDigits !== 8) throw new Error("Digit count is not supported");
  const rawPeriod = entry.otp.period ?? 30;
  if (!Number.isInteger(rawPeriod) || (rawPeriod as number) < 1 || (rawPeriod as number) > 300) {
    throw new Error("Period is outside the supported range");
  }

  const issuer = optionalText(entry.otp.issuer, `${field}.otp.issuer`, MAX_SERVICE_CHARACTERS);
  const account = optionalText(entry.otp.account, `${field}.otp.account`, MAX_IDENTITY_CHARACTERS);
  const label = optionalText(entry.otp.label, `${field}.otp.label`, MAX_IDENTITY_CHARACTERS);
  const identityFromLabel = label?.includes(":") ? label.slice(label.indexOf(":") + 1).trim() : label;
  // Both official apps permit account and label to be null. Coffer needs a
  // display identity, so retain the service name rather than dropping an
  // otherwise valid token from the import review.
  const identity = account ?? identityFromLabel ?? fallbackService;

  let group = "Imported";
  if (entry.groupId !== undefined && entry.groupId !== null) {
    const groupId = safeText(entry.groupId, `${field}.groupId`, MAX_GROUP_ID_CHARACTERS);
    const mappedGroup = groups.get(groupId);
    if (!mappedGroup) throw new Error("Group reference is invalid");
    group = mappedGroup;
  }

  return {
    service: issuer ?? fallbackService,
    identity,
    secret,
    group,
    favorite: false,
    archived: false,
    algorithm: parseAlgorithm(entry.otp.algorithm),
    digits: rawDigits,
    period: rawPeriod as number,
  };
}

function itemLabel(entry: unknown, index: number): string {
  if (!isRecord(entry)) return `Account ${index + 1}`;
  const otp = isRecord(entry.otp) ? entry.otp : {};
  const service = safePreview(otp.issuer) ?? safePreview(entry.name);
  const account = safePreview(otp.account) ?? safePreview(otp.label);
  return [service, account].filter((part): part is string => Boolean(part)).join(" — ") || `Account ${index + 1}`;
}

function servicesToImportBatch(
  services: unknown[],
  groups: ReadonlyMap<string, string>,
): ImportBatch {
  const items: ImportItem[] = services.map((entry, index) => {
    const label = itemLabel(entry, index);
    try {
      return { key: `2fas-${index}`, label, account: parseService(entry, index, groups) };
    } catch (error) {
      return { key: `2fas-${index}`, label, issue: error instanceof Error ? error.message : "Account is invalid" };
    }
  });
  return { source: "2FAS", items };
}

/** Parses an unencrypted or password-protected 2FAS schema v1-v4 backup. */
export async function parseTwoFasBackup(input: string, password?: string): Promise<ImportBatch> {
  const envelope = validateEnvelope(inputToJson(input));
  const groups = parseGroups(envelope.groups);
  const services = await decryptServices(envelope, password);
  return servicesToImportBatch(services, groups);
}

function validateExportAccount(account: CofferAccount, index: number): CofferAccount & {
  algorithm: CofferTotpAlgorithm;
  digits: 6 | 8;
  period: number;
} {
  if (!isRecord(account)) throw new Error(`accounts[${index}] must be an object`);
  const service = safeText(account.service, `accounts[${index}].service`, MAX_SERVICE_CHARACTERS);
  const identity = safeText(account.identity, `accounts[${index}].identity`, MAX_IDENTITY_CHARACTERS);
  const group = safeText(account.group, `accounts[${index}].group`, MAX_GROUP_CHARACTERS);
  if (typeof account.secret !== "string") throw new Error(`accounts[${index}].secret is not valid Base32`);
  const secret = parseBase32Secret(account.secret);
  const algorithm = account.algorithm ?? "SHA-1";
  if (algorithm !== "SHA-1" && algorithm !== "SHA-256" && algorithm !== "SHA-512") {
    throw new Error(`accounts[${index}].algorithm is not supported by 2FAS TOTP backups`);
  }
  const digits = account.digits ?? 6;
  if (digits !== 6 && digits !== 8) throw new Error(`accounts[${index}].digits is not supported by 2FAS TOTP backups`);
  const period = account.period ?? 30;
  if (!Number.isInteger(period) || ![10, 30, 60, 90].includes(period)) {
    throw new Error(`accounts[${index}].period must be 10, 30, 60, or 90 seconds for 2FAS`);
  }
  return { ...account, service, identity, group, secret, algorithm, digits, period };
}

function randomUuid(): string {
  const bytes = cryptoApi().getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function makeGroups(accounts: readonly CofferAccount[], updatedAt: number): {
  groups: Array<{ id: string; name: string; isExpanded: boolean; updatedAt: number }>;
  ids: Map<string, string>;
} {
  const ids = new Map<string, string>();
  for (const account of accounts) {
    if (!ids.has(account.group)) ids.set(account.group, randomUuid());
  }
  const groups = [...ids.entries()].map(([name, id]) => ({ id, name, isExpanded: true, updatedAt }));
  return { groups, ids };
}

function exportAlgorithm(algorithm: CofferTotpAlgorithm): string {
  return algorithm.replace("-", "");
}

function serviceInitials(service: string): string {
  const initials = service
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => [...part][0] ?? "")
    .join("")
    .toLocaleUpperCase("en-US");
  return [...initials].slice(0, 2).join("") || "?";
}

function makeServices(
  accounts: readonly ReturnType<typeof validateExportAccount>[],
  groupIds: ReadonlyMap<string, string>,
  updatedAt: number,
): unknown[] {
  return accounts.map((account, position) => ({
    name: account.service,
    secret: account.secret,
    updatedAt,
    type: null,
    serviceTypeID: null,
    otp: {
      link: createOtpAuthUri({
        issuer: account.service,
        account: account.identity,
        secret: account.secret,
        algorithm: account.algorithm,
        digits: account.digits,
        period: account.period,
      }),
      label: account.identity,
      account: account.identity,
      issuer: account.service,
      digits: account.digits,
      period: account.period,
      algorithm: exportAlgorithm(account.algorithm),
      counter: null,
      tokenType: "TOTP",
      source: "Link",
    },
    order: { position },
    badge: null,
    icon: {
      selected: "Label",
      brand: null,
      label: {
        text: serviceInitials(account.service),
        backgroundColor: "Default",
      },
      iconCollection: { id: "a5b3fb65-4ec5-43e6-8ec1-49e24ca9e7ad" },
    },
    groupId: groupIds.get(account.group) ?? null,
  }));
}

function distinctRandomIv(first?: Uint8Array): Uint8Array {
  let iv: Uint8Array;
  do {
    iv = cryptoApi().getRandomValues(new Uint8Array(IV_BYTES));
  } while (first && bytesEqual(first, iv));
  return iv;
}

async function encryptValue(plaintext: Uint8Array, key: CryptoKey, iv: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await cryptoApi().subtle.encrypt(
      { name: "AES-GCM", iv: copyToArrayBuffer(iv), tagLength: AES_GCM_TAG_BYTES * 8 },
      key,
      copyToArrayBuffer(plaintext),
    ),
  );
}

/** Creates a password-protected 2FAS schema v4 backup containing representable TOTP accounts. */
export async function createTwoFasBackup(accounts: readonly CofferAccount[], password: string): Promise<string> {
  if (!Array.isArray(accounts)) throw new Error("accounts must be an array");
  if (accounts.length > MAX_ACCOUNTS) throw new Error("A 2FAS backup cannot contain more than 1,000 accounts");
  validateExportPassword(password);
  const validated = accounts.map(validateExportAccount);
  const updatedAt = Date.now();
  const { groups, ids } = makeGroups(validated, updatedAt);
  const services = makeServices(validated, ids, updatedAt);
  const servicesPlaintext = utf8Encoder.encode(JSON.stringify(services));
  if (servicesPlaintext.byteLength > MAX_PLAINTEXT_BYTES) {
    servicesPlaintext.fill(0);
    throw new Error("2FAS services exceed the 5 MiB plaintext limit");
  }

  const salt = cryptoApi().getRandomValues(new Uint8Array(SALT_BYTES));
  const servicesIv = distinctRandomIv();
  const referenceIv = distinctRandomIv(servicesIv);
  const key = await deriveKey(password, salt, "encrypt");
  let servicesCiphertext: Uint8Array;
  let referencePlaintext: Uint8Array | undefined;
  let referenceCiphertext: Uint8Array;
  try {
    servicesCiphertext = await encryptValue(servicesPlaintext, key, servicesIv);
    referencePlaintext = utf8Encoder.encode(TWOFAS_REFERENCE);
    referenceCiphertext = await encryptValue(referencePlaintext, key, referenceIv);
  } finally {
    servicesPlaintext.fill(0);
    referencePlaintext?.fill(0);
  }

  const serialized = JSON.stringify(
    {
      services: [],
      groups,
      updatedAt,
      schemaVersion: TWOFAS_SCHEMA_VERSION,
      appVersionCode: 1,
      appVersionName: "Coffer 1.0",
      appOrigin: "android",
      account: null,
      servicesEncrypted: serializeEncryptedValue(servicesCiphertext, salt, servicesIv),
      reference: serializeEncryptedValue(referenceCiphertext, salt, referenceIv),
    },
    null,
    2,
  );
  if (utf8Encoder.encode(serialized).byteLength > MAX_FILE_BYTES) {
    throw new Error("Encrypted 2FAS backup exceeds the 5 MiB file limit");
  }
  return serialized;
}
