import { parseBase32Secret, type TotpAlgorithm } from "./totp";

export const VAULT_PAYLOAD_FORMAT = "coffer-vault" as const;
export const LEGACY_VAULT_PAYLOAD_VERSION = 1 as const;
export const PREVIOUS_VAULT_PAYLOAD_VERSION = 2 as const;
export const PRE_CUSTOMIZATION_VAULT_PAYLOAD_VERSION = 3 as const;
export const PRE_GROUP_CUSTOMIZATION_VAULT_PAYLOAD_VERSION = 4 as const;
export const PRE_ACCOUNT_ICON_VAULT_PAYLOAD_VERSION = 5 as const;
export const PRE_GROUP_ORDER_VAULT_PAYLOAD_VERSION = 6 as const;
export const PRE_MAIN_SCREEN_VAULT_PAYLOAD_VERSION = 7 as const;
export const PRE_GROUP_STYLE_EXPANSION_VAULT_PAYLOAD_VERSION = 8 as const;
export const VAULT_PAYLOAD_VERSION = 9 as const;
export const MAX_VAULT_ACCOUNTS = 5_000;
export const MAX_PROFILE_AVATAR_BYTES = 512 * 1024;
export const ACCOUNT_ICON_SIZE = 128;
export const MAX_ACCOUNT_ICON_BYTES = 96 * 1024;
export const MAX_VAULT_ACCOUNT_ICON_BYTES = 2 * 1024 * 1024;

export type VaultColor = "ink" | "orange" | "blue" | "violet" | "green";
export type VaultTheme = "dark" | "light";
export type VaultGroupIcon =
  | "dot"
  | "folder"
  | "briefcase"
  | "person"
  | "shield"
  | "star"
  | "home"
  | "code"
  | "work"
  | "personal"
  | "shopping"
  | "finance"
  | "travel"
  | "education"
  | "health"
  | "social"
  | "import"
  | "ai"
  | "drive"
  | "forum";
export type VaultGroupColor =
  | "rose"
  | "amber"
  | "lime"
  | "emerald"
  | "sky"
  | "blue"
  | "violet"
  | "slate"
  | "coral"
  | "teal"
  | "magenta"
  | "indigo";

export type VaultGroupCustomization = {
  name: string;
  icon: VaultGroupIcon;
  color: VaultGroupColor;
};

export type VaultMainScreen =
  | { kind: "all" }
  | { kind: "group"; group: string };

export type VaultAccount = {
  id: string;
  service: string;
  identity: string;
  secret: string;
  group: string;
  color: VaultColor;
  letter: string;
  favorite: boolean;
  lastUsed: number;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
  archived: boolean;
  /** A local bundled brand id. Null keeps automatic service-name detection. */
  iconBrand: string | null;
  /** A normalized local PNG stored only inside the encrypted payload. */
  iconDataUrl: string | null;
};

export type VaultProfile = {
  name: string;
  email: string;
  /** A validated image data URL stored only inside the encrypted payload. */
  avatarDataUrl: string | null;
};

export type NewVaultProfile = Omit<VaultProfile, "avatarDataUrl"> & Partial<Pick<VaultProfile, "avatarDataUrl">>;

export type VaultSettings = {
  autoLockMinutes: number;
  lockWhenHidden: boolean;
  clearClipboard: boolean;
  theme: VaultTheme;
  mainScreen: VaultMainScreen;
};

export type PersistedVault = {
  format: typeof VAULT_PAYLOAD_FORMAT;
  version: typeof VAULT_PAYLOAD_VERSION;
  profile: VaultProfile;
  settings: VaultSettings;
  accounts: VaultAccount[];
  groupCustomizations: VaultGroupCustomization[];
  groupOrder: string[];
  createdAt: string;
  updatedAt: string;
};

const LEGACY_ROOT_FIELDS = ["format", "version", "profile", "settings", "accounts", "createdAt", "updatedAt"] as const;
const GROUP_CUSTOMIZATION_ROOT_FIELDS = [...LEGACY_ROOT_FIELDS, "groupCustomizations"] as const;
const ROOT_FIELDS = [...GROUP_CUSTOMIZATION_ROOT_FIELDS, "groupOrder"] as const;
const LEGACY_PROFILE_FIELDS = ["name", "email"] as const;
const PROFILE_FIELDS = [...LEGACY_PROFILE_FIELDS, "avatarDataUrl"] as const;
const VERSION_1_SETTINGS_FIELDS = ["autoLockMinutes", "lockWhenHidden", "clearClipboard", "interfaceScale"] as const;
const VERSION_2_SETTINGS_FIELDS = [...VERSION_1_SETTINGS_FIELDS, "theme"] as const;
const PRE_MAIN_SCREEN_SETTINGS_FIELDS = ["autoLockMinutes", "lockWhenHidden", "clearClipboard", "theme"] as const;
const SETTINGS_FIELDS = [...PRE_MAIN_SCREEN_SETTINGS_FIELDS, "mainScreen"] as const;
const LEGACY_ACCOUNT_FIELDS = ["id", "service", "identity", "secret", "group", "color", "letter", "favorite", "lastUsed", "algorithm", "digits", "period", "archived"] as const;
const BRAND_ACCOUNT_FIELDS = [...LEGACY_ACCOUNT_FIELDS, "iconBrand"] as const;
const ACCOUNT_FIELDS = [...BRAND_ACCOUNT_FIELDS, "iconDataUrl"] as const;
const GROUP_CUSTOMIZATION_FIELDS = ["name", "icon", "color"] as const;
const GROUP_ICONS = [
  "dot",
  "folder",
  "briefcase",
  "person",
  "shield",
  "star",
  "home",
  "code",
  "work",
  "personal",
  "shopping",
  "finance",
  "travel",
  "education",
  "health",
  "social",
  "import",
  "ai",
  "drive",
  "forum",
] as const satisfies readonly VaultGroupIcon[];
const GROUP_COLORS = [
  "rose",
  "amber",
  "lime",
  "emerald",
  "sky",
  "blue",
  "violet",
  "slate",
  "coral",
  "teal",
  "magenta",
  "indigo",
] as const satisfies readonly VaultGroupColor[];
export const MAX_GROUP_CUSTOMIZATIONS = 256;
export const MAX_GROUP_ORDER_ENTRIES = MAX_VAULT_ACCOUNTS + MAX_GROUP_CUSTOMIZATIONS;
export const MAX_VAULT_GROUP_NAME_LENGTH = 80;

const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const LOCAL_ICON_BRAND = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function requireExactFields(value: Record<string, unknown>, fields: readonly string[], path: string) {
  const keys = Object.keys(value);
  if (keys.length !== fields.length || keys.some((key) => !fields.includes(key))) {
    throw new Error(`${path} contains unsupported or missing fields`);
  }
}

function requireText(value: unknown, path: string, maximum: number, allowEmpty = false) {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && value.trim().length === 0) || hasControlCharacters(value)) {
    throw new Error(`${path} is invalid`);
  }
  return value;
}

function requireTimestamp(value: unknown, path: string) {
  const text = requireText(value, path, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(text) || !Number.isFinite(Date.parse(text))) {
    throw new Error(`${path} is invalid`);
  }
  return text;
}

function imagePrefix(value: string) {
  try {
    return Uint8Array.from(atob(value.slice(0, 16)), (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

export function parseProfileAvatarDataUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("profile.avatarDataUrl is invalid");
  const maximumEncodedCharacters = Math.ceil(MAX_PROFILE_AVATAR_BYTES / 3) * 4;
  if (value.length > "data:image/webp;base64,".length + maximumEncodedCharacters) {
    throw new Error(`profile.avatarDataUrl must be at most ${MAX_PROFILE_AVATAR_BYTES} bytes`);
  }

  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/u.exec(value);
  if (!match || !CANONICAL_BASE64.test(match[2])) throw new Error("profile.avatarDataUrl is invalid");
  const encoded = match[2];
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const decodedBytes = (encoded.length / 4) * 3 - padding;
  if (decodedBytes < 1 || decodedBytes > MAX_PROFILE_AVATAR_BYTES) {
    throw new Error(`profile.avatarDataUrl must be at most ${MAX_PROFILE_AVATAR_BYTES} bytes`);
  }

  const prefix = imagePrefix(encoded);
  const mime = match[1];
  const png = prefix.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => prefix[index] === byte);
  const jpeg = prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff;
  const webp = prefix.length >= 12 &&
    String.fromCharCode(...prefix.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...prefix.slice(8, 12)) === "WEBP";
  if ((mime === "png" && !png) || (mime === "jpeg" && !jpeg) || (mime === "webp" && !webp)) {
    throw new Error("profile.avatarDataUrl does not match its image type");
  }
  return value;
}

export function parseLocalIconBrand(value: unknown, path = "iconBrand"): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !LOCAL_ICON_BRAND.test(value)) {
    throw new Error(`${path} is invalid`);
  }
  return value;
}

function decodedBase64Bytes(encoded: string) {
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return (encoded.length / 4) * 3 - padding;
}

function uint32BigEndian(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

export function parseAccountIconDataUrl(value: unknown, path = "iconDataUrl"): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${path} is invalid`);
  const prefix = "data:image/png;base64,";
  const maximumEncodedCharacters = Math.ceil(MAX_ACCOUNT_ICON_BYTES / 3) * 4;
  if (value.length > prefix.length + maximumEncodedCharacters) {
    throw new Error(`${path} must be at most ${MAX_ACCOUNT_ICON_BYTES} bytes`);
  }

  const match = /^data:image\/png;base64,([A-Za-z0-9+/]*={0,2})$/u.exec(value);
  if (!match || !CANONICAL_BASE64.test(match[1])) throw new Error(`${path} is invalid`);
  const encoded = match[1];
  const decodedBytes = decodedBase64Bytes(encoded);
  if (decodedBytes < 33 || decodedBytes > MAX_ACCOUNT_ICON_BYTES) {
    throw new Error(`${path} must be a non-empty PNG of at most ${MAX_ACCOUNT_ICON_BYTES} bytes`);
  }

  let header: Uint8Array;
  try {
    header = Uint8Array.from(atob(encoded.slice(0, 44)), (character) => character.charCodeAt(0));
  } catch {
    throw new Error(`${path} is invalid`);
  }
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const hasPngSignature = pngSignature.every((byte, index) => header[index] === byte);
  const hasIhdr =
    header.length >= 24 &&
    uint32BigEndian(header, 8) === 13 &&
    String.fromCharCode(...header.slice(12, 16)) === "IHDR";
  if (!hasPngSignature || !hasIhdr) throw new Error(`${path} must be a valid PNG`);
  if (
    uint32BigEndian(header, 16) !== ACCOUNT_ICON_SIZE ||
    uint32BigEndian(header, 20) !== ACCOUNT_ICON_SIZE
  ) {
    throw new Error(`${path} must be exactly ${ACCOUNT_ICON_SIZE} by ${ACCOUNT_ICON_SIZE} pixels`);
  }
  return value;
}

function parseProfile(value: unknown, version: SupportedVaultPayloadVersion): VaultProfile {
  if (!isRecord(value)) throw new Error("profile is invalid");
  const supportsCustomization =
    version === PRE_GROUP_CUSTOMIZATION_VAULT_PAYLOAD_VERSION ||
    version === PRE_ACCOUNT_ICON_VAULT_PAYLOAD_VERSION ||
    version === PRE_GROUP_ORDER_VAULT_PAYLOAD_VERSION ||
    version === PRE_MAIN_SCREEN_VAULT_PAYLOAD_VERSION ||
    version === PRE_GROUP_STYLE_EXPANSION_VAULT_PAYLOAD_VERSION ||
    version === VAULT_PAYLOAD_VERSION;
  requireExactFields(value, supportsCustomization ? PROFILE_FIELDS : LEGACY_PROFILE_FIELDS, "profile");
  const name = requireText(value.name, "profile.name", 80);
  const email = requireText(value.email, "profile.email", 254).trim();
  if (!/^[^\s@]+@[^\s@]+$/u.test(email)) throw new Error("profile.email is invalid");
  return {
    name: name.trim(),
    email,
    avatarDataUrl: supportsCustomization ? parseProfileAvatarDataUrl(value.avatarDataUrl) : null,
  };
}

type SupportedVaultPayloadVersion =
  | typeof LEGACY_VAULT_PAYLOAD_VERSION
  | typeof PREVIOUS_VAULT_PAYLOAD_VERSION
  | typeof PRE_CUSTOMIZATION_VAULT_PAYLOAD_VERSION
  | typeof PRE_GROUP_CUSTOMIZATION_VAULT_PAYLOAD_VERSION
  | typeof PRE_ACCOUNT_ICON_VAULT_PAYLOAD_VERSION
  | typeof PRE_GROUP_ORDER_VAULT_PAYLOAD_VERSION
  | typeof PRE_MAIN_SCREEN_VAULT_PAYLOAD_VERSION
  | typeof PRE_GROUP_STYLE_EXPANSION_VAULT_PAYLOAD_VERSION
  | typeof VAULT_PAYLOAD_VERSION;

function parseMainScreen(value: unknown): VaultMainScreen {
  if (!isRecord(value)) throw new Error("settings.mainScreen is invalid");
  if (value.kind === "all") {
    requireExactFields(value, ["kind"], "settings.mainScreen");
    return { kind: "all" };
  }
  if (value.kind === "group") {
    requireExactFields(value, ["kind", "group"], "settings.mainScreen");
    const group = requireText(value.group, "settings.mainScreen.group", 48).trim().replace(/\s+/gu, " ");
    if (orderedGroupKey(group) === "all") throw new Error("settings.mainScreen.group is reserved");
    return { kind: "group", group };
  }
  throw new Error("settings.mainScreen is invalid");
}

function parseSettings(value: unknown, version: SupportedVaultPayloadVersion): VaultSettings {
  if (!isRecord(value)) throw new Error("settings is invalid");
  const fields = version === LEGACY_VAULT_PAYLOAD_VERSION
    ? VERSION_1_SETTINGS_FIELDS
    : version === PREVIOUS_VAULT_PAYLOAD_VERSION
      ? VERSION_2_SETTINGS_FIELDS
      : version === PRE_GROUP_STYLE_EXPANSION_VAULT_PAYLOAD_VERSION || version === VAULT_PAYLOAD_VERSION
        ? SETTINGS_FIELDS
        : PRE_MAIN_SCREEN_SETTINGS_FIELDS;
  requireExactFields(value, fields, "settings");
  const autoLockMinutes = value.autoLockMinutes;
  if (![0, 1, 5, 15, 30].includes(autoLockMinutes as number)) throw new Error("settings.autoLockMinutes is invalid");
  if (typeof value.lockWhenHidden !== "boolean" || typeof value.clearClipboard !== "boolean") throw new Error("settings switches are invalid");
  if (
    (version === LEGACY_VAULT_PAYLOAD_VERSION || version === PREVIOUS_VAULT_PAYLOAD_VERSION) &&
    value.interfaceScale !== "comfortable" &&
    value.interfaceScale !== "large"
  ) throw new Error("settings.interfaceScale is invalid");
  if (version !== LEGACY_VAULT_PAYLOAD_VERSION && value.theme !== "dark" && value.theme !== "light") throw new Error("settings.theme is invalid");
  const theme: VaultTheme = version === LEGACY_VAULT_PAYLOAD_VERSION ? "dark" : value.theme as VaultTheme;
  const mainScreen = version === PRE_GROUP_STYLE_EXPANSION_VAULT_PAYLOAD_VERSION || version === VAULT_PAYLOAD_VERSION
    ? parseMainScreen(value.mainScreen)
    : { kind: "all" } as const;
  return {
    autoLockMinutes: autoLockMinutes as number,
    // Version 1 enabled this by default, which made tab switches look like
    // premature inactivity locks. Migrate it to an explicit opt-in.
    lockWhenHidden: version === LEGACY_VAULT_PAYLOAD_VERSION ? false : value.lockWhenHidden,
    clearClipboard: value.clearClipboard,
    theme,
    mainScreen,
  };
}

function parseAccount(value: unknown, index: number, version: SupportedVaultPayloadVersion): VaultAccount {
  const path = `accounts[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} is invalid`);
  const supportsBrandCustomization =
    version === PRE_GROUP_CUSTOMIZATION_VAULT_PAYLOAD_VERSION ||
    version === PRE_ACCOUNT_ICON_VAULT_PAYLOAD_VERSION ||
    version === PRE_GROUP_ORDER_VAULT_PAYLOAD_VERSION ||
    version === PRE_MAIN_SCREEN_VAULT_PAYLOAD_VERSION ||
    version === PRE_GROUP_STYLE_EXPANSION_VAULT_PAYLOAD_VERSION ||
    version === VAULT_PAYLOAD_VERSION;
  const supportsAccountIcons =
    version === PRE_GROUP_ORDER_VAULT_PAYLOAD_VERSION ||
    version === PRE_MAIN_SCREEN_VAULT_PAYLOAD_VERSION ||
    version === PRE_GROUP_STYLE_EXPANSION_VAULT_PAYLOAD_VERSION ||
    version === VAULT_PAYLOAD_VERSION;
  requireExactFields(
    value,
    supportsAccountIcons
      ? ACCOUNT_FIELDS
      : supportsBrandCustomization
        ? BRAND_ACCOUNT_FIELDS
        : LEGACY_ACCOUNT_FIELDS,
    path,
  );
  const algorithm = value.algorithm;
  const digits = value.digits;
  const period = value.period;
  const color = value.color;
  const lastUsed = value.lastUsed;
  if (algorithm !== "SHA-1" && algorithm !== "SHA-256" && algorithm !== "SHA-512") throw new Error(`${path}.algorithm is invalid`);
  if (digits !== 6 && digits !== 8) throw new Error(`${path}.digits is invalid`);
  if (typeof period !== "number" || !Number.isInteger(period) || period < 1 || period > 300) throw new Error(`${path}.period is invalid`);
  if (color !== "ink" && color !== "orange" && color !== "blue" && color !== "violet" && color !== "green") throw new Error(`${path}.color is invalid`);
  if (typeof lastUsed !== "number" || !Number.isSafeInteger(lastUsed) || lastUsed < 0) throw new Error(`${path}.lastUsed is invalid`);
  if (typeof value.favorite !== "boolean" || typeof value.archived !== "boolean") throw new Error(`${path} flags are invalid`);
  const iconBrand = supportsBrandCustomization ? parseLocalIconBrand(value.iconBrand, `${path}.iconBrand`) : null;
  const iconDataUrl = supportsAccountIcons
    ? parseAccountIconDataUrl(value.iconDataUrl, `${path}.iconDataUrl`)
    : null;
  if (iconBrand && iconDataUrl) throw new Error(`${path} cannot use both iconBrand and iconDataUrl`);
  return {
    id: requireText(value.id, `${path}.id`, 128),
    service: requireText(value.service, `${path}.service`, 256).trim(),
    identity: requireText(value.identity, `${path}.identity`, 256).trim(),
    secret: parseBase32Secret(requireText(value.secret, `${path}.secret`, 1_024)),
    group: requireText(value.group, `${path}.group`, MAX_VAULT_GROUP_NAME_LENGTH).trim(),
    color,
    letter: requireText(value.letter, `${path}.letter`, 3).toUpperCase(),
    favorite: value.favorite,
    lastUsed,
    algorithm,
    digits,
    period,
    archived: value.archived,
    iconBrand,
    iconDataUrl,
  };
}

function normalizedGroupName(value: string) {
  return value.normalize("NFKC").toLowerCase();
}

function orderedGroupKey(value: string) {
  return value.trim().replace(/\s+/gu, " ").normalize("NFKC").toLocaleLowerCase("en");
}

function parseGroupCustomizations(value: unknown): VaultGroupCustomization[] {
  if (!Array.isArray(value) || value.length > MAX_GROUP_CUSTOMIZATIONS) {
    throw new Error("groupCustomizations is invalid");
  }

  const normalizedNames = new Set<string>();
  return value.map((customization, index) => {
    const path = `groupCustomizations[${index}]`;
    if (!isRecord(customization)) throw new Error(`${path} is invalid`);
    requireExactFields(customization, GROUP_CUSTOMIZATION_FIELDS, path);
    if (typeof customization.name !== "string" || /\p{Cc}/u.test(customization.name)) {
      throw new Error(`${path}.name is invalid`);
    }
    const name = customization.name.trim();
    if (name.length < 1 || name.length > 48) throw new Error(`${path}.name is invalid`);
    const normalizedName = normalizedGroupName(name);
    if (normalizedName === "all") throw new Error(`${path}.name is reserved`);
    if (normalizedNames.has(normalizedName)) throw new Error("groupCustomizations contains duplicate names");
    normalizedNames.add(normalizedName);
    if (!GROUP_ICONS.includes(customization.icon as VaultGroupIcon)) throw new Error(`${path}.icon is invalid`);
    if (!GROUP_COLORS.includes(customization.color as VaultGroupColor)) throw new Error(`${path}.color is invalid`);
    return {
      name,
      icon: customization.icon as VaultGroupIcon,
      color: customization.color as VaultGroupColor,
    };
  });
}

function parseGroupOrder(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_GROUP_ORDER_ENTRIES) {
    throw new Error("groupOrder is invalid");
  }

  const normalizedNames = new Set<string>();
  return value.map((entry, index) => {
    const path = `groupOrder[${index}]`;
    const name = requireText(entry, path, MAX_VAULT_GROUP_NAME_LENGTH).trim();
    const normalizedName = orderedGroupKey(name);
    if (normalizedNames.has(normalizedName)) throw new Error("groupOrder contains duplicate names");
    normalizedNames.add(normalizedName);
    return name;
  });
}

function availableGroupNames(
  accounts: readonly VaultAccount[],
  groupCustomizations: readonly VaultGroupCustomization[],
): string[] {
  const names = new Map<string, string>();
  for (const account of accounts) {
    if (!account.archived) names.set(orderedGroupKey(account.group), account.group);
  }
  for (const customization of groupCustomizations) {
    names.set(orderedGroupKey(customization.name), customization.name);
  }
  for (const account of accounts) {
    const key = orderedGroupKey(account.group);
    if (!names.has(key)) names.set(key, account.group);
  }
  return [...names.values()];
}

function visibleMainScreenGroupNames(
  accounts: readonly VaultAccount[],
  groupCustomizations: readonly VaultGroupCustomization[],
): string[] {
  const names = new Map<string, string>();
  for (const account of accounts) {
    if (!account.archived) names.set(orderedGroupKey(account.group), account.group);
  }
  for (const customization of groupCustomizations) {
    names.set(orderedGroupKey(customization.name), customization.name);
  }
  return [...names.values()];
}

function reconcileMainScreen(
  mainScreen: VaultMainScreen,
  accounts: readonly VaultAccount[],
  groupCustomizations: readonly VaultGroupCustomization[],
): VaultMainScreen {
  if (mainScreen.kind === "all") return mainScreen;
  const visibleGroups = visibleMainScreenGroupNames(accounts, groupCustomizations);
  const visibleByKey = new Map(visibleGroups.map((name) => [orderedGroupKey(name), name]));
  const group = visibleByKey.get(orderedGroupKey(mainScreen.group));
  return group ? { kind: "group", group } : { kind: "all" };
}

function reconcileGroupOrder(
  requestedOrder: readonly string[],
  accounts: readonly VaultAccount[],
  groupCustomizations: readonly VaultGroupCustomization[],
): string[] {
  const availableNames = availableGroupNames(accounts, groupCustomizations);
  const availableByKey = new Map(availableNames.map((name) => [orderedGroupKey(name), name]));
  const usedKeys = new Set<string>();
  const order: string[] = [];

  for (const requestedName of requestedOrder) {
    const key = orderedGroupKey(requestedName);
    const availableName = availableByKey.get(key);
    if (!availableName || usedKeys.has(key)) continue;
    usedKeys.add(key);
    order.push(availableName);
  }
  for (const availableName of availableNames) {
    const key = orderedGroupKey(availableName);
    if (usedKeys.has(key)) continue;
    usedKeys.add(key);
    order.push(availableName);
  }
  return order;
}

export function createEmptyVault(profile: NewVaultProfile, now = new Date()): PersistedVault {
  const timestamp = now.toISOString();
  return parsePersistedVault({
    format: VAULT_PAYLOAD_FORMAT,
    version: VAULT_PAYLOAD_VERSION,
    profile: { ...profile, avatarDataUrl: profile.avatarDataUrl ?? null },
    settings: {
      autoLockMinutes: 5,
      lockWhenHidden: false,
      clearClipboard: true,
      theme: "dark",
      mainScreen: { kind: "all" },
    },
    accounts: [],
    groupCustomizations: [],
    groupOrder: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function parsePersistedVault(value: unknown): PersistedVault {
  if (!isRecord(value)) throw new Error("Vault payload is invalid");
  if (
    value.format !== VAULT_PAYLOAD_FORMAT ||
    (
      value.version !== LEGACY_VAULT_PAYLOAD_VERSION &&
      value.version !== PREVIOUS_VAULT_PAYLOAD_VERSION &&
      value.version !== PRE_CUSTOMIZATION_VAULT_PAYLOAD_VERSION &&
      value.version !== PRE_GROUP_CUSTOMIZATION_VAULT_PAYLOAD_VERSION &&
      value.version !== PRE_ACCOUNT_ICON_VAULT_PAYLOAD_VERSION &&
      value.version !== PRE_GROUP_ORDER_VAULT_PAYLOAD_VERSION &&
      value.version !== PRE_MAIN_SCREEN_VAULT_PAYLOAD_VERSION &&
      value.version !== PRE_GROUP_STYLE_EXPANSION_VAULT_PAYLOAD_VERSION &&
      value.version !== VAULT_PAYLOAD_VERSION
    )
  ) {
    throw new Error("Vault payload format is not supported");
  }
  const sourceVersion = value.version;
  const supportsGroupCustomizations =
    sourceVersion === PRE_ACCOUNT_ICON_VAULT_PAYLOAD_VERSION ||
    sourceVersion === PRE_GROUP_ORDER_VAULT_PAYLOAD_VERSION ||
    sourceVersion === PRE_MAIN_SCREEN_VAULT_PAYLOAD_VERSION ||
    sourceVersion === PRE_GROUP_STYLE_EXPANSION_VAULT_PAYLOAD_VERSION ||
    sourceVersion === VAULT_PAYLOAD_VERSION;
  const supportsGroupOrder =
    sourceVersion === PRE_MAIN_SCREEN_VAULT_PAYLOAD_VERSION ||
    sourceVersion === PRE_GROUP_STYLE_EXPANSION_VAULT_PAYLOAD_VERSION ||
    sourceVersion === VAULT_PAYLOAD_VERSION;
  requireExactFields(
    value,
    supportsGroupOrder
      ? ROOT_FIELDS
      : supportsGroupCustomizations
        ? GROUP_CUSTOMIZATION_ROOT_FIELDS
        : LEGACY_ROOT_FIELDS,
    "vault",
  );
  if (!Array.isArray(value.accounts) || value.accounts.length > MAX_VAULT_ACCOUNTS) throw new Error("Vault account list is invalid");
  const createdAt = requireTimestamp(value.createdAt, "createdAt");
  const updatedAt = requireTimestamp(value.updatedAt, "updatedAt");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new Error("Vault timestamps are inconsistent");
  const accounts = value.accounts.map((account, index) => parseAccount(account, index, sourceVersion));
  if (new Set(accounts.map((account) => account.id)).size !== accounts.length) throw new Error("Vault contains duplicate account ids");
  const accountIconBytes = accounts.reduce((total, account) => {
    if (!account.iconDataUrl) return total;
    const encoded = account.iconDataUrl.slice(account.iconDataUrl.indexOf(",") + 1);
    return total + decodedBase64Bytes(encoded);
  }, 0);
  if (accountIconBytes > MAX_VAULT_ACCOUNT_ICON_BYTES) {
    throw new Error(`Vault account icons must total at most ${MAX_VAULT_ACCOUNT_ICON_BYTES} bytes`);
  }
  const groupCustomizations = supportsGroupCustomizations
    ? parseGroupCustomizations(value.groupCustomizations)
    : [];
  const requestedGroupOrder = supportsGroupOrder
    ? parseGroupOrder(value.groupOrder)
    : availableGroupNames(accounts, groupCustomizations);
  const settings = parseSettings(value.settings, sourceVersion);
  return {
    format: VAULT_PAYLOAD_FORMAT,
    version: VAULT_PAYLOAD_VERSION,
    profile: parseProfile(value.profile, sourceVersion),
    settings: {
      ...settings,
      mainScreen: reconcileMainScreen(settings.mainScreen, accounts, groupCustomizations),
    },
    accounts,
    groupCustomizations,
    groupOrder: reconcileGroupOrder(requestedGroupOrder, accounts, groupCustomizations),
    createdAt,
    updatedAt,
  };
}

export function withVaultUpdate(vault: PersistedVault, patch: Partial<Pick<PersistedVault, "profile" | "settings" | "accounts" | "groupCustomizations" | "groupOrder">>, now = new Date()) {
  return parsePersistedVault({ ...vault, ...patch, updatedAt: now.toISOString() });
}
