import { constants as fsConstants, readFileSync, statSync } from "node:fs";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";

export const OIDC_SETTINGS_FILE_FORMAT = "coffer-oidc-settings" as const;
export const OIDC_SETTINGS_FILE_VERSION = 1 as const;
export const OIDC_CALLBACK_PATH = "/api/auth/oidc/callback";

export type OidcClientAuthMethod = "client_secret_basic" | "client_secret_post" | "none";
export type OidcSettingsSource = "environment" | "volume" | "none";

export type OidcRuntimeSettings = {
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  clientAuthMethod: OidcClientAuthMethod;
  providerName: string;
  scopes: string;
  redirectUri: string;
  source: OidcSettingsSource;
};

export type OidcAdminSettings = Omit<OidcRuntimeSettings, "clientSecret"> & {
  clientSecretConfigured: boolean;
};

export type OidcSettingsUpdate = {
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string | null;
  clientAuthMethod: OidcClientAuthMethod;
  providerName: string;
  scopes: string;
  redirectUri: string;
};

type StoredOidcSettings = {
  format: typeof OIDC_SETTINGS_FILE_FORMAT;
  version: typeof OIDC_SETTINGS_FILE_VERSION;
  updatedAt: string;
  enabled: boolean;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  clientAuthMethod: OidcClientAuthMethod;
  providerName: string;
  scopes: string;
  redirectUri: string;
};

type CachedSettings = {
  path: string;
  fingerprint: string;
  settings: OidcRuntimeSettings;
};

type OidcSettingsGlobal = typeof globalThis & {
  __cofferOidcSettingsCache?: CachedSettings | null;
  __cofferOidcSettingsMutation?: Promise<void>;
};

const runtimeGlobal = globalThis as OidcSettingsGlobal;
const MAX_SETTINGS_BYTES = 64 * 1024;
const MAX_SECRET_LENGTH = 8_192;

export class OidcSettingsStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcSettingsStoreError";
  }
}

export function getOidcSettingsPath(): string {
  return resolve(process.env.COFFER_DATA_DIR ?? "data", "oidc-settings.json");
}

export function readOidcSettings(): OidcRuntimeSettings {
  const path = getOidcSettingsPath();
  let fileStat: ReturnType<typeof statSync>;
  try {
    fileStat = statSync(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return environmentSettings();
    throw error;
  }
  if (!fileStat.isFile()) {
    throw new OidcSettingsStoreError("The OIDC settings path is not a regular file.");
  }
  if (fileStat.size > MAX_SETTINGS_BYTES) {
    throw new OidcSettingsStoreError("The OIDC settings file is too large.");
  }
  const fingerprint = `${fileStat.mtimeMs}:${fileStat.size}`;
  const cached = runtimeGlobal.__cofferOidcSettingsCache;
  if (cached?.path === path && cached.fingerprint === fingerprint) {
    return structuredClone(cached.settings);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new OidcSettingsStoreError("The OIDC settings file could not be read.");
  }
  if (!isStoredOidcSettings(parsed)) {
    throw new OidcSettingsStoreError("The OIDC settings file has an unsupported format.");
  }
  const settings = normalizeSettings({
    enabled: parsed.enabled,
    issuerUrl: parsed.issuerUrl,
    clientId: parsed.clientId,
    clientSecret: parsed.clientSecret,
    clientAuthMethod: parsed.clientAuthMethod,
    providerName: parsed.providerName,
    scopes: parsed.scopes,
    redirectUri: parsed.redirectUri,
  }, "volume");
  runtimeGlobal.__cofferOidcSettingsCache = { path, fingerprint, settings };
  return structuredClone(settings);
}

export function publicOidcSettings(): OidcAdminSettings {
  const { clientSecret, ...settings } = readOidcSettings();
  return { ...settings, clientSecretConfigured: Boolean(clientSecret) };
}

export function prepareOidcSettingsUpdate(input: OidcSettingsUpdate): OidcRuntimeSettings {
  const current = readOidcSettings();
  return normalizeSettings({
    ...input,
    clientSecret: input.clientSecret === null ? current.clientSecret : input.clientSecret,
  }, "volume");
}

export async function writeOidcSettings(settings: OidcRuntimeSettings): Promise<void> {
  const path = getOidcSettingsPath();
  await withMutationLock(async () => {
    const targetDirectory = dirname(path);
    await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
    await chmod(targetDirectory, 0o700).catch(() => undefined);
    const tempPath = resolve(
      targetDirectory,
      `.coffer-oidc-${Buffer.from(randomBytes(12)).toString("hex")}.tmp`,
    );
    const stored: StoredOidcSettings = {
      format: OIDC_SETTINGS_FILE_FORMAT,
      version: OIDC_SETTINGS_FILE_VERSION,
      updatedAt: new Date().toISOString(),
      enabled: settings.enabled,
      issuerUrl: settings.issuerUrl,
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      clientAuthMethod: settings.clientAuthMethod,
      providerName: settings.providerName,
      scopes: settings.scopes,
      redirectUri: settings.redirectUri,
    };
    const serialized = `${JSON.stringify(stored)}\n`;
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
      runtimeGlobal.__cofferOidcSettingsCache = null;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  });
}

function environmentSettings(): OidcRuntimeSettings {
  const issuerUrl = process.env.COFFER_OIDC_ISSUER_URL?.trim() ?? "";
  const clientId = process.env.COFFER_OIDC_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.COFFER_OIDC_CLIENT_SECRET?.trim() ?? "";
  const configured = Boolean(issuerUrl || clientId || clientSecret);
  return normalizeSettings({
    enabled: configured,
    issuerUrl,
    clientId,
    clientSecret,
    clientAuthMethod: readAuthMethod(process.env.COFFER_OIDC_CLIENT_AUTH_METHOD, clientSecret),
    providerName: process.env.COFFER_OIDC_PROVIDER_NAME ?? "OpenID Connect",
    scopes: process.env.COFFER_OIDC_SCOPES ?? "openid email profile",
    redirectUri: process.env.COFFER_OIDC_REDIRECT_URI ?? "",
  }, configured ? "environment" : "none", false);
}

function normalizeSettings(
  input: Omit<OidcRuntimeSettings, "source">,
  source: OidcSettingsSource,
  validateEnabled = true,
): OidcRuntimeSettings {
  const settings: OidcRuntimeSettings = {
    enabled: input.enabled,
    issuerUrl: boundedText(input.issuerUrl, 2_048, "OIDC issuer URL"),
    clientId: boundedText(input.clientId, 512, "OIDC client ID"),
    clientSecret: boundedText(input.clientSecret, MAX_SECRET_LENGTH, "OIDC client secret", false),
    clientAuthMethod: readAuthMethod(input.clientAuthMethod, input.clientSecret),
    providerName: boundedText(input.providerName, 80, "OIDC provider name") || "OpenID Connect",
    scopes: normalizeScopes(input.scopes),
    redirectUri: boundedText(input.redirectUri, 2_048, "OIDC redirect URI"),
    source,
  };
  if (!settings.enabled || !validateEnabled) return settings;
  if (!settings.issuerUrl || !settings.clientId) {
    throw new OidcSettingsStoreError("OIDC issuer URL and client ID are required.");
  }
  validateHttpsUrl(settings.issuerUrl, "OIDC issuer URL");
  if (settings.clientAuthMethod !== "none" && !settings.clientSecret) {
    throw new OidcSettingsStoreError("A client secret is required for the selected authentication method.");
  }
  if (settings.redirectUri) validateRedirectUri(settings.redirectUri);
  return settings;
}

function boundedText(value: string, maximum: number, label: string, trim = true): string {
  if (typeof value !== "string") throw new OidcSettingsStoreError(`${label} is invalid.`);
  const candidate = trim ? value.trim() : value;
  if (candidate.length > maximum || containsControlCharacters(candidate)) {
    throw new OidcSettingsStoreError(`${label} is invalid.`);
  }
  return candidate;
}

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function readAuthMethod(value: string | undefined, clientSecret: string): OidcClientAuthMethod {
  const candidate = value?.trim().toLowerCase() || (clientSecret ? "client_secret_basic" : "none");
  if (candidate !== "client_secret_basic" && candidate !== "client_secret_post" && candidate !== "none") {
    throw new OidcSettingsStoreError("The OIDC client authentication method is invalid.");
  }
  return candidate;
}

function normalizeScopes(value: string): string {
  if (typeof value !== "string" || value.length > 1_024) {
    throw new OidcSettingsStoreError("OIDC scopes are invalid.");
  }
  const scopes = new Set(value.split(/\s+/u).filter(Boolean));
  scopes.add("openid");
  scopes.add("email");
  return [...scopes].join(" ");
}

function validateHttpsUrl(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new OidcSettingsStoreError(`${label} must be a valid URL.`);
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new OidcSettingsStoreError(`${label} must not contain credentials, a query, or a fragment.`);
  }
  if (parsed.protocol !== "https:" && !isLoopbackHostname(parsed.hostname)) {
    throw new OidcSettingsStoreError(`${label} must use HTTPS.`);
  }
  return parsed;
}

function validateRedirectUri(value: string): void {
  const parsed = validateHttpsUrl(value, "OIDC redirect URI");
  if (parsed.pathname !== OIDC_CALLBACK_PATH) {
    throw new OidcSettingsStoreError(`OIDC redirect URI must point to ${OIDC_CALLBACK_PATH}.`);
  }
}

function isStoredOidcSettings(value: unknown): value is StoredOidcSettings {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [
    "clientAuthMethod",
    "clientId",
    "clientSecret",
    "enabled",
    "format",
    "issuerUrl",
    "providerName",
    "redirectUri",
    "scopes",
    "updatedAt",
    "version",
  ].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]) &&
    value.format === OIDC_SETTINGS_FILE_FORMAT &&
    value.version === OIDC_SETTINGS_FILE_VERSION &&
    typeof value.updatedAt === "string" &&
    typeof value.enabled === "boolean" &&
    typeof value.issuerUrl === "string" &&
    typeof value.clientId === "string" &&
    typeof value.clientSecret === "string" &&
    typeof value.clientAuthMethod === "string" &&
    typeof value.providerName === "string" &&
    typeof value.scopes === "string" &&
    typeof value.redirectUri === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = runtimeGlobal.__cofferOidcSettingsMutation ?? Promise.resolve();
  let release: () => void = () => {};
  runtimeGlobal.__cofferOidcSettingsMutation = new Promise<void>((resolveMutation) => {
    release = resolveMutation;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}
