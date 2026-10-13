import { constants as fsConstants, readFileSync, statSync } from "node:fs";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { isIP } from "node:net";

export const SMTP_SETTINGS_FILE_FORMAT = "coffer-smtp-settings" as const;
export const SMTP_SETTINGS_FILE_VERSION = 1 as const;

export type SmtpSettingsSource = "environment" | "volume" | "none";

export type SmtpRuntimeSettings = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  source: SmtpSettingsSource;
};

export type SmtpAdminSettings = Omit<SmtpRuntimeSettings, "password"> & {
  passwordConfigured: boolean;
};

export type SmtpSettingsUpdate = Omit<SmtpRuntimeSettings, "source" | "password"> & {
  password: string | null;
};

type StoredSmtpSettings = {
  format: typeof SMTP_SETTINGS_FILE_FORMAT;
  version: typeof SMTP_SETTINGS_FILE_VERSION;
  updatedAt: string;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

type CachedSettings = {
  path: string;
  fingerprint: string;
  settings: SmtpRuntimeSettings;
};

type SmtpSettingsGlobal = typeof globalThis & {
  __cofferSmtpSettingsCache?: CachedSettings | null;
  __cofferSmtpSettingsMutation?: Promise<void>;
};

const runtimeGlobal = globalThis as SmtpSettingsGlobal;
const MAX_SETTINGS_BYTES = 64 * 1024;
const MAX_SECRET_LENGTH = 8_192;

export class SmtpSettingsStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SmtpSettingsStoreError";
  }
}

export function getSmtpSettingsPath(): string {
  return resolve(process.env.COFFER_DATA_DIR ?? "data", "smtp-settings.json");
}

export function readSmtpSettings(): SmtpRuntimeSettings {
  const path = getSmtpSettingsPath();
  let fileStat: ReturnType<typeof statSync>;
  try {
    fileStat = statSync(path);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) return environmentSettings();
    throw error;
  }
  if (!fileStat.isFile()) {
    throw new SmtpSettingsStoreError("The SMTP settings path is not a regular file.");
  }
  if (fileStat.size > MAX_SETTINGS_BYTES) {
    throw new SmtpSettingsStoreError("The SMTP settings file is too large.");
  }
  const fingerprint = `${fileStat.mtimeMs}:${fileStat.size}`;
  const cached = runtimeGlobal.__cofferSmtpSettingsCache;
  if (cached?.path === path && cached.fingerprint === fingerprint) {
    return structuredClone(cached.settings);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new SmtpSettingsStoreError("The SMTP settings file could not be read.");
  }
  if (!isStoredSmtpSettings(parsed)) {
    throw new SmtpSettingsStoreError("The SMTP settings file has an unsupported format.");
  }
  const settings = normalizeSettings({
    enabled: parsed.enabled,
    host: parsed.host,
    port: parsed.port,
    secure: parsed.secure,
    user: parsed.user,
    password: parsed.password,
    from: parsed.from,
  }, "volume");
  runtimeGlobal.__cofferSmtpSettingsCache = { path, fingerprint, settings };
  return structuredClone(settings);
}

export function publicSmtpSettings(): SmtpAdminSettings {
  const { password, ...settings } = readSmtpSettings();
  return { ...settings, passwordConfigured: Boolean(password) };
}

export function prepareSmtpSettingsUpdate(input: SmtpSettingsUpdate): SmtpRuntimeSettings {
  const current = readSmtpSettings();
  return normalizeSettings({
    ...input,
    password: input.password === null ? current.password : input.password,
  }, "volume");
}

export async function writeSmtpSettings(settings: SmtpRuntimeSettings): Promise<void> {
  const path = getSmtpSettingsPath();
  await withMutationLock(async () => {
    const targetDirectory = dirname(path);
    await mkdir(targetDirectory, { recursive: true, mode: 0o700 });
    await chmod(targetDirectory, 0o700).catch(() => undefined);
    const tempPath = resolve(
      targetDirectory,
      `.coffer-smtp-${Buffer.from(randomBytes(12)).toString("hex")}.tmp`,
    );
    const stored: StoredSmtpSettings = {
      format: SMTP_SETTINGS_FILE_FORMAT,
      version: SMTP_SETTINGS_FILE_VERSION,
      updatedAt: new Date().toISOString(),
      enabled: settings.enabled,
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      user: settings.user,
      password: settings.password,
      from: settings.from,
    };
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(
        tempPath,
        fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
        0o600,
      );
      await handle.writeFile(`${JSON.stringify(stored)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(tempPath, path);
      await chmod(path, 0o600).catch(() => undefined);
      runtimeGlobal.__cofferSmtpSettingsCache = null;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  });
}

function environmentSettings(): SmtpRuntimeSettings {
  const host = process.env.COFFER_SMTP_HOST?.trim() ?? "";
  const from = process.env.COFFER_SMTP_FROM?.trim() ?? "";
  const user = process.env.COFFER_SMTP_USER?.trim() ?? "";
  const password = process.env.COFFER_SMTP_PASSWORD ?? "";
  const configured = Boolean(host || from || user || password);
  const rawPort = Number(process.env.COFFER_SMTP_PORT?.trim() || "587");
  const port = Number.isSafeInteger(rawPort) && rawPort >= 1 && rawPort <= 65_535
    ? rawPort
    : 587;
  const enabled = Boolean(host && from && (Boolean(user) === Boolean(password))) && port === rawPort;
  return normalizeSettings({
    enabled,
    host,
    port,
    secure: process.env.COFFER_SMTP_SECURE === "1",
    user,
    password,
    from,
  }, configured ? "environment" : "none", false);
}

function normalizeSettings(
  input: Omit<SmtpRuntimeSettings, "source">,
  source: SmtpSettingsSource,
  validateEnabled = true,
): SmtpRuntimeSettings {
  const settings: SmtpRuntimeSettings = {
    enabled: input.enabled,
    host: boundedText(input.host, 253, "SMTP host"),
    port: input.port,
    secure: input.secure,
    user: boundedText(input.user, 512, "SMTP username"),
    password: boundedText(input.password, MAX_SECRET_LENGTH, "SMTP password", false),
    from: boundedText(input.from, 512, "SMTP sender"),
    source,
  };
  if (!Number.isSafeInteger(settings.port) || settings.port < 1 || settings.port > 65_535) {
    throw new SmtpSettingsStoreError("SMTP port must be between 1 and 65535.");
  }
  if (settings.host && isIP(settings.host) === 0 && !/^[A-Za-z0-9._-]+$/u.test(settings.host)) {
    throw new SmtpSettingsStoreError("SMTP host must be a hostname or IP address without a protocol or port.");
  }
  if (!settings.enabled || !validateEnabled) return settings;
  if (!settings.host || !settings.from) {
    throw new SmtpSettingsStoreError("SMTP host and sender address are required.");
  }
  if (!settings.from.includes("@")) {
    throw new SmtpSettingsStoreError("SMTP sender must contain a valid email address.");
  }
  if (Boolean(settings.user) !== Boolean(settings.password)) {
    throw new SmtpSettingsStoreError("SMTP username and password must be configured together.");
  }
  return settings;
}

function boundedText(value: string, maximum: number, label: string, trim = true): string {
  if (typeof value !== "string") throw new SmtpSettingsStoreError(`${label} is invalid.`);
  const candidate = trim ? value.trim() : value;
  if (candidate.length > maximum || containsControlCharacters(candidate)) {
    throw new SmtpSettingsStoreError(`${label} is invalid.`);
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

function isStoredSmtpSettings(value: unknown): value is StoredSmtpSettings {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [
    "enabled", "format", "from", "host", "password", "port", "secure",
    "updatedAt", "user", "version",
  ].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]) &&
    value.format === SMTP_SETTINGS_FILE_FORMAT &&
    value.version === SMTP_SETTINGS_FILE_VERSION &&
    typeof value.updatedAt === "string" &&
    typeof value.enabled === "boolean" &&
    typeof value.host === "string" &&
    typeof value.port === "number" &&
    typeof value.secure === "boolean" &&
    typeof value.user === "string" &&
    typeof value.password === "string" &&
    typeof value.from === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = runtimeGlobal.__cofferSmtpSettingsMutation ?? Promise.resolve();
  let release: () => void = () => {};
  runtimeGlobal.__cofferSmtpSettingsMutation = new Promise<void>((resolveMutation) => {
    release = resolveMutation;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}
