export type TotpAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";
export type OtpType = "totp" | "hotp";
export type OtpDigits = 6 | 8;
export const MAX_HOTP_COUNTER = Number.MAX_SAFE_INTEGER;

export type TotpConfiguration = Readonly<{
  secret: string;
  algorithm: TotpAlgorithm;
  digits: OtpDigits;
  period: number;
  otpType?: OtpType;
  counter?: number;
}>;

export type TotpTestPreview = Readonly<{
  code: string;
  generatedAt: number;
  expiresAt: number;
}>;

export type ParsedOtpAuth = {
  issuer: string;
  account: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: OtpDigits;
  period: number;
  otpType?: OtpType;
  counter?: number;
};

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const MAX_BASE32_SECRET_CHARACTERS = 1_024;
const BASE32_PADDING_BY_REMAINDER: Readonly<Record<number, number>> = { 0: 0, 2: 6, 4: 4, 5: 3, 7: 1 };
const BASE32_UNUSED_BITS_BY_REMAINDER: Readonly<Record<number, number>> = { 0: 0, 2: 2, 4: 4, 5: 1, 7: 3 };

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function normalizeSecret(secret: string) {
  return secret.replace(/[a-z]/g, (character) => character.toUpperCase()).replace(/[\s=-]/g, "");
}

export function parseBase32Secret(secret: string) {
  if (secret !== secret.trim() || secret.length === 0) throw new Error("The secret is not valid Base32");
  const match = /^([A-Za-z2-7]+)(=*)$/u.exec(secret);
  if (!match) throw new Error("The secret is not valid Base32");

  const canonical = match[1].toUpperCase();
  const padding = match[2];
  if (canonical.length < 16 || canonical.length > MAX_BASE32_SECRET_CHARACTERS) {
    throw new Error(`The secret must contain between 16 and ${MAX_BASE32_SECRET_CHARACTERS} Base32 characters`);
  }

  const remainder = canonical.length % 8;
  const requiredPadding = BASE32_PADDING_BY_REMAINDER[remainder];
  if (requiredPadding === undefined || (padding.length > 0 && padding.length !== requiredPadding)) {
    throw new Error("The secret has invalid Base32 padding");
  }

  const unusedBits = BASE32_UNUSED_BITS_BY_REMAINDER[remainder];
  if (unusedBits > 0) {
    const lastValue = BASE32_ALPHABET.indexOf(canonical[canonical.length - 1]);
    if ((lastValue & ((1 << unusedBits) - 1)) !== 0) throw new Error("The secret has non-zero Base32 padding bits");
  }
  return canonical;
}

export function isValidBase32(secret: string) {
  try {
    parseBase32Secret(normalizeSecret(secret));
    return true;
  } catch {
    return false;
  }
}

function base32ToBytes(secret: string) {
  const normalized = parseBase32Secret(secret);

  let bits = "";
  for (const char of normalized) {
    bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, "0");
  }

  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  return bytes;
}

async function generateOtpBinary(secret: string, counter: number, algorithm: TotpAlgorithm) {
  validateHotpCounter(counter);
  const message = new ArrayBuffer(8);
  const view = new DataView(message);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);

  const key = await crypto.subtle.importKey(
    "raw",
    base32ToBytes(secret),
    { name: "HMAC", hash: { name: algorithm } },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return binary;
}

export function validateHotpCounter(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Counter must be a whole number between 0 and ${MAX_HOTP_COUNTER}.`);
  }
  return value;
}

export function validateOtpSettings(values: TotpConfiguration) {
  const otpType = values.otpType ?? "totp";
  if (!["totp", "hotp"].includes(otpType)) throw new Error("Choose a supported OTP type.");
  if (!["SHA-1", "SHA-256", "SHA-512"].includes(values.algorithm)) throw new Error("Choose a supported OTP algorithm.");
  if (values.digits !== 6 && values.digits !== 8) throw new Error("Digit count must be 6 or 8.");
  if (!Number.isInteger(values.period) || values.period < 1 || values.period > 300) {
    throw new Error("Period must be a whole number between 1 and 300 seconds.");
  }
  const counter = otpType === "hotp" ? validateHotpCounter(values.counter) : 0;
  if (otpType !== "hotp" && values.counter !== undefined && values.counter !== 0) throw new Error("Only HOTP accounts may have a counter.");
  return { otpType, counter, algorithm: values.algorithm, digits: values.digits, period: otpType === "hotp" ? 30 : values.period };
}

export function normalizeAccountSecret(secret: string) {
  return parseBase32Secret(normalizeSecret(secret));
}

export async function generateHotp(secret: string, counter: number, digits = 6, algorithm: TotpAlgorithm = "SHA-1") {
  if (digits !== 6 && digits !== 8) throw new Error("HOTP requires 6 or 8 digits.");
  const binary = await generateOtpBinary(secret, counter, algorithm);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export async function generateTotp(secret: string, timestamp = Date.now(), digits = 6, period = 30, algorithm: TotpAlgorithm = "SHA-1") {
  if (!Number.isInteger(period) || period < 1 || period > 300 || !Number.isFinite(timestamp) || timestamp < 0) throw new Error("Invalid TOTP time or period.");
  return generateHotp(secret, totpWindow(timestamp, period).counter, digits, algorithm);
}

export async function generateAccountCode(configuration: TotpConfiguration, timestamp = Date.now()) {
  const settings = validateOtpSettings(configuration);
  const secret = normalizeAccountSecret(configuration.secret);
  if (settings.otpType === "hotp") return generateHotp(secret, settings.counter, settings.digits, settings.algorithm);
  return generateTotp(secret, timestamp, settings.digits, settings.period, settings.algorithm);
}

export function totpWindow(timestamp: number, period: number) {
  const counter = Math.floor(timestamp / 1000 / period);
  return {
    counter,
    currentTimestamp: counter * period * 1000,
    nextTimestamp: (counter + 1) * period * 1000,
  };
}

export function isTotpExpiring(remainingSeconds: number) {
  return Number.isFinite(remainingSeconds) && remainingSeconds > 0 && remainingSeconds <= 5;
}

export function formatCode(code: string) {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export async function generateTotpTestPreview(
  configuration: TotpConfiguration,
  timestamp = Date.now(),
): Promise<TotpTestPreview> {
  const { nextTimestamp } = totpWindow(timestamp, configuration.period);
  const code = await generateAccountCode(configuration, timestamp);
  return {
    code: formatCode(code),
    generatedAt: timestamp,
    expiresAt: configuration.otpType === "hotp" ? Number.POSITIVE_INFINITY : nextTimestamp,
  };
}

export function parseOtpAuthUri(value: string): ParsedOtpAuth {
  const input = value.trim();
  if (input.length === 0 || input.length > 8_192) throw new Error("The setup link is empty or too long");
  const url = new URL(input);
  if (url.protocol !== "otpauth:" || !["totp", "hotp"].includes(url.hostname)) {
    throw new Error("Use a valid TOTP or HOTP otpauth:// setup link");
  }

  const getSingleParameter = (name: string) => {
    const values = url.searchParams.getAll(name);
    if (values.length > 1) throw new Error(`The setup link repeats the ${name} parameter`);
    return values[0];
  };

  const label = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const encoder = getSingleParameter("encoder");
  if (encoder !== undefined) throw new Error("The setup link uses an unsupported encoder");
  const otpType: OtpType = url.hostname === "hotp" ? "hotp" : "totp";
  const counterParameter = getSingleParameter("counter");
  if (otpType === "hotp" && (counterParameter === undefined || !/^\d+$/u.test(counterParameter))) throw new Error("HOTP setup links require a valid counter");
  if (otpType !== "hotp" && counterParameter !== undefined) throw new Error("Only HOTP setup links may specify a counter");
  const counter = otpType === "hotp" ? validateHotpCounter(Number(counterParameter)) : 0;
  const separator = label.indexOf(":");
  const issuerFromLabel = separator >= 0 ? label.slice(0, separator).replace(/ +$/u, "") : "";
  const account = (separator >= 0 ? label.slice(separator + 1) : label).replace(/^ +/u, "");
  if (separator >= 0 && account.includes(":")) throw new Error("The setup link label contains more than one separator");

  const secret = getSingleParameter("secret");
  if (secret === undefined) throw new Error("The setup link is missing the secret parameter");
  const issuerFromQuery = getSingleParameter("issuer") ?? "";
  if (issuerFromLabel && issuerFromQuery && issuerFromLabel !== issuerFromQuery) {
    throw new Error("The issuer in the label does not match the issuer parameter");
  }
  const issuer = issuerFromQuery || issuerFromLabel;
  const algorithmParameter = getSingleParameter("algorithm");
  const suppliedAlgorithm = (algorithmParameter ?? "SHA1").toUpperCase();
  if (
    (algorithmParameter !== undefined && !/^[A-Za-z0-9-]+$/u.test(algorithmParameter)) ||
    !["SHA1", "SHA-1", "SHA256", "SHA-256", "SHA512", "SHA-512"].includes(suppliedAlgorithm)
  ) {
    throw new Error("The setup link uses an unsupported algorithm");
  }
  const rawAlgorithm = suppliedAlgorithm.replace("-", "");
  if (!["SHA1", "SHA256", "SHA512"].includes(rawAlgorithm)) throw new Error("The setup link uses an unsupported algorithm");
  const algorithm: TotpAlgorithm = rawAlgorithm === "SHA256" ? "SHA-256" : rawAlgorithm === "SHA512" ? "SHA-512" : "SHA-1";
  const digitsParameter = getSingleParameter("digits");
  if (digitsParameter !== undefined && !/^\d+$/u.test(digitsParameter)) {
    throw new Error("The setup link uses an invalid digit count");
  }
  const rawDigits = Number(digitsParameter ?? "6");
  const digits: OtpDigits | null = rawDigits === 8 ? 8 : rawDigits === 6 ? 6 : null;
  const periodParameter = getSingleParameter("period");
  if (periodParameter !== undefined && !/^\d+$/u.test(periodParameter)) {
    throw new Error("The setup link uses an invalid period");
  }
  const period = otpType === "hotp" ? 30 : Number(periodParameter ?? "30");
  const canonicalSecret = parseBase32Secret(secret);

  if (!account || issuer.length > 256 || account.length > 256 || hasControlCharacters(`${issuer}${account}`) || !digits || !Number.isInteger(period) || period < 1 || period > 300) {
    throw new Error("The setup link is missing an account or valid OTP settings");
  }

  validateOtpSettings({ secret: canonicalSecret, algorithm, digits, period, otpType, counter });
  return { issuer, account, secret: canonicalSecret, algorithm, digits, period, ...(otpType !== "totp" ? { otpType, counter } : {}) };
}

export function createOtpAuthUri(account: ParsedOtpAuth) {
  const settings = validateOtpSettings(account);
  if (!account.issuer.trim() || !account.account.trim() || !isValidBase32(account.secret)) {
    throw new Error("Cannot export an incomplete authenticator account");
  }

  const label = `${encodeURIComponent(account.issuer.trim())}:${encodeURIComponent(account.account.trim())}`;
  const params = new URLSearchParams({
    secret: normalizeSecret(account.secret),
    issuer: account.issuer.trim(),
    algorithm: account.algorithm.replace("-", ""),
    digits: String(account.digits),
    period: String(account.period),
  });
  if (settings.otpType === "hotp") {
    params.delete("period");
    params.set("counter", String(settings.counter));
  }
  return `otpauth://${settings.otpType === "hotp" ? "hotp" : "totp"}/${label}?${params.toString()}`;
}
