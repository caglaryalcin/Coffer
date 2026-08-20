export type TotpAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

export type TotpConfiguration = Readonly<{
  secret: string;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
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
  digits: 6 | 8;
  period: number;
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

export async function generateTotp(
  secret: string,
  timestamp = Date.now(),
  digits = 6,
  period = 30,
  algorithm: TotpAlgorithm = "SHA-1",
) {
  const { counter } = totpWindow(timestamp, period);
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
  return String(binary % 10 ** digits).padStart(digits, "0");
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
  const code = await generateTotp(
    configuration.secret,
    timestamp,
    configuration.digits,
    configuration.period,
    configuration.algorithm,
  );
  return {
    code: formatCode(code),
    generatedAt: timestamp,
    expiresAt: nextTimestamp,
  };
}

export function parseOtpAuthUri(value: string): ParsedOtpAuth {
  const input = value.trim();
  if (input.length === 0 || input.length > 8_192) throw new Error("The setup link is empty or too long");
  const url = new URL(input);
  if (url.protocol !== "otpauth:" || url.hostname !== "totp") {
    throw new Error("Use a valid otpauth://totp setup link");
  }

  const getSingleParameter = (name: string) => {
    const values = url.searchParams.getAll(name);
    if (values.length > 1) throw new Error(`The setup link repeats the ${name} parameter`);
    return values[0];
  };

  const label = decodeURIComponent(url.pathname.replace(/^\//, ""));
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
  const digits = rawDigits === 8 ? 8 : rawDigits === 6 ? 6 : null;
  const periodParameter = getSingleParameter("period");
  if (periodParameter !== undefined && !/^\d+$/u.test(periodParameter)) {
    throw new Error("The setup link uses an invalid period");
  }
  const period = Number(periodParameter ?? "30");
  const canonicalSecret = parseBase32Secret(secret);

  if (!account || issuer.length > 256 || account.length > 256 || hasControlCharacters(`${issuer}${account}`) || !digits || !Number.isInteger(period) || period < 1 || period > 300) {
    throw new Error("The setup link is missing an account or valid TOTP settings");
  }

  return { issuer, account, secret: canonicalSecret, algorithm, digits, period };
}

export function createOtpAuthUri(account: ParsedOtpAuth) {
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
  return `otpauth://totp/${label}?${params.toString()}`;
}
