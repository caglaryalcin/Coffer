import {
  normalizeAccountSecret,
  validateOtpSettings,
  type OtpDigits,
  type OtpType,
  type TotpAlgorithm,
  type TotpConfiguration,
} from "./totp";
import { parseAccountIconDataUrl, parseAccountUrls, parseLocalIconBrand, type VaultAccount } from "./vault-model";

export type AccountEditorValues = {
  service: string;
  identity: string;
  urls: string[];
  secret: string;
  iconBrand: string | null;
  iconDataUrl: string | null;
  algorithm: TotpAlgorithm;
  digits: OtpDigits;
  otpType: OtpType;
  counter: number;
  period: number;
};

export type EditableAccountPatch = AccountEditorValues & { letter: string };

export type AccountSecretTestDraft = Pick<
  AccountEditorValues,
  "secret" | "algorithm" | "digits" | "period" | "otpType" | "counter"
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
  values: AccountSecretTestDraft,
) {
  return validateOtpSettings(values);
}

export function accountSecretTestReadiness(
  savedSecret: string,
  draft: AccountSecretTestDraft,
  savedSettings?: TotpConfiguration,
): AccountSecretTestReadiness {
  let canonicalDraft: string;
  let canonicalSaved: string;
  try {
    canonicalDraft = normalizeAccountSecret(draft.secret);
  } catch {
    return { status: "invalid", message: "Enter a valid Base32 secret before testing." };
  }
  try {
    canonicalSaved = normalizeAccountSecret(savedSecret);
  } catch {
    return { status: "invalid", message: "The saved secret could not be tested." };
  }

  if (canonicalDraft === canonicalSaved && (!savedSettings || (
    (draft.otpType ?? "totp") === (savedSettings.otpType ?? "totp")
    && (draft.counter ?? 0) === (savedSettings.counter ?? 0)
    && draft.algorithm === savedSettings.algorithm && draft.digits === savedSettings.digits
    && draft.period === savedSettings.period
  ))) return { status: "unchanged" };

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
    urls: account.urls.length > 0 ? [...account.urls] : [""],
    secret: account.secret,
    iconBrand: account.iconBrand,
    iconDataUrl: account.iconDataUrl,
    otpType: account.otpType ?? "totp",
    counter: account.counter ?? 0,
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
  const urls = parseAccountUrls(values.urls.filter((url) => url.trim()), "Website URLs");
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
    urls,
    secret: normalizeAccountSecret(values.secret),
    iconBrand,
    iconDataUrl,
    ...settings,
    letter: accountLetter(service),
  };
}
