import {
  normalizeSecret,
  parseBase32Secret,
  type TotpAlgorithm,
  type TotpConfiguration,
} from "./totp";
import { parseAccountIconDataUrl, parseLocalIconBrand, type VaultAccount } from "./vault-model";

export type AccountEditorValues = {
  service: string;
  identity: string;
  secret: string;
  iconBrand: string | null;
  iconDataUrl: string | null;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
};

export type EditableAccountPatch = AccountEditorValues & {
  letter: string;
};

export type AccountSecretTestDraft = Pick<
  AccountEditorValues,
  "secret" | "algorithm" | "digits" | "period"
>;

export type AccountSecretTestReadiness =
  | { status: "unchanged" }
  | { status: "invalid"; message: string }
  | { status: "ready"; configuration: TotpConfiguration };

export function accountEditorReturnFocusTarget<T>(
  returnFocusTo: T | null | undefined,
  activeElement: T | null,
): T | null {
  return returnFocusTo ?? activeElement;
}

function validateTotpSettings(
  values: Pick<AccountEditorValues, "algorithm" | "digits" | "period">,
): Pick<TotpConfiguration, "algorithm" | "digits" | "period"> {
  if (values.algorithm !== "SHA-1" && values.algorithm !== "SHA-256" && values.algorithm !== "SHA-512") {
    throw new Error("Choose a supported TOTP algorithm.");
  }
  if (values.digits !== 6 && values.digits !== 8) throw new Error("Digit count must be 6 or 8.");
  if (!Number.isInteger(values.period) || values.period < 1 || values.period > 300) {
    throw new Error("Period must be a whole number between 1 and 300 seconds.");
  }
  return { algorithm: values.algorithm, digits: values.digits, period: values.period };
}

export function accountSecretTestReadiness(
  savedSecret: string,
  draft: AccountSecretTestDraft,
): AccountSecretTestReadiness {
  let canonicalDraft: string;
  let canonicalSaved: string;
  try {
    canonicalDraft = parseBase32Secret(normalizeSecret(draft.secret));
  } catch {
    return { status: "invalid", message: "Enter a valid Base32 secret before testing." };
  }
  try {
    canonicalSaved = parseBase32Secret(normalizeSecret(savedSecret));
  } catch {
    return { status: "invalid", message: "The saved secret could not be tested." };
  }

  if (canonicalDraft === canonicalSaved) return { status: "unchanged" };

  try {
    const settings = validateTotpSettings(draft);
    return {
      status: "ready",
      configuration: { secret: canonicalDraft, ...settings },
    };
  } catch (error) {
    return {
      status: "invalid",
      message: error instanceof Error ? error.message : "The draft TOTP settings are invalid.",
    };
  }
}

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function cleanText(value: unknown, label: string, maximum: number) {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maximum || hasControlCharacters(cleaned)) {
    throw new Error(`${label} must be between 1 and ${maximum} characters.`);
  }
  return cleaned;
}

export function accountLetter(service: string) {
  const words = service.trim().split(/\s+/u);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : service.slice(0, 2))
    .slice(0, 3)
    .toUpperCase();
}

export function accountEditorValues(account: VaultAccount): AccountEditorValues {
  return {
    service: account.service,
    identity: account.identity,
    secret: account.secret,
    iconBrand: account.iconBrand,
    iconDataUrl: account.iconDataUrl,
    algorithm: account.algorithm,
    digits: account.digits,
    period: account.period,
  };
}

export function validateAccountEditorValues(
  values: AccountEditorValues,
  availableIconBrands?: readonly string[],
): EditableAccountPatch {
  const service = cleanText(values.service, "Service name", 256);
  const identity = cleanText(values.identity, "Username", 256);
  const iconBrand = parseLocalIconBrand(values.iconBrand);
  const iconDataUrl = parseAccountIconDataUrl(values.iconDataUrl);
  if (iconBrand && iconDataUrl) {
    throw new Error("Choose either a Coffer catalog icon or an uploaded logo, not both.");
  }
  if (iconBrand && availableIconBrands && !availableIconBrands.includes(iconBrand)) {
    throw new Error("Choose an icon from the local Coffer catalog.");
  }
  const settings = validateTotpSettings(values);

  return {
    service,
    identity,
    secret: parseBase32Secret(normalizeSecret(values.secret)),
    iconBrand,
    iconDataUrl,
    ...settings,
    letter: accountLetter(service),
  };
}
