import type { CofferAccount, CofferTotpAlgorithm } from "./backup";
import { parseBase32Secret, parseOtpAuthUri } from "./totp";

export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ACCOUNTS = 1_000;

export type ImportItem = {
  key: string;
  label: string;
  account?: CofferAccount;
  issue?: string;
};

export type ImportBatch = {
  source: "2FAuth" | "2FAS" | "OTPAuth list";
  items: ImportItem[];
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function safeText(value: unknown, field: string, maximum = 256) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum || hasControlCharacters(value)) {
    throw new Error(`${field} is missing or invalid`);
  }
  return value.trim();
}

function parseAlgorithm(value: unknown): CofferTotpAlgorithm {
  if (typeof value !== "string") throw new Error("Algorithm is invalid");
  const supplied = value.toUpperCase();
  if (!/^[A-Za-z0-9-]+$/u.test(value) || !["SHA1", "SHA-1", "SHA256", "SHA-256", "SHA512", "SHA-512"].includes(supplied)) {
    throw new Error("Algorithm is not supported");
  }
  const normalized = supplied.replace("-", "");
  if (normalized === "SHA1") return "SHA-1";
  if (normalized === "SHA256") return "SHA-256";
  if (normalized === "SHA512") return "SHA-512";
  throw new Error("Algorithm is invalid");
}

function parseTotpRecord(value: unknown): CofferAccount {
  if (!isRecord(value)) throw new Error("Account entry is not an object");
  const requiredFields = ["otp_type", "service", "account", "secret", "digits", "algorithm", "period", "counter"];
  if (requiredFields.some((field) => !Object.hasOwn(value, field))) throw new Error("Account entry is incomplete");
  if (typeof value.otp_type !== "string") throw new Error("OTP type is invalid");
  const type = value.otp_type.toLowerCase();
  if (type !== "totp") throw new Error(`${type.toUpperCase()} accounts are not supported yet`);

  const service = safeText(value.service, "Service");
  const identity = safeText(value.account, "Account");
  if (typeof value.secret !== "string") throw new Error("Secret is not valid Base32");
  const secret = parseBase32Secret(value.secret);
  const digits = value.digits;
  const period = value.period;
  if (digits !== 6 && digits !== 8) throw new Error("Digit count is not supported");
  if (typeof period !== "number" || !Number.isInteger(period) || period < 1 || period > 300) throw new Error("Period is outside the supported range");
  if (value.counter !== null) throw new Error("Counter must be null for a TOTP account");

  return {
    service,
    identity,
    secret,
    group: "Imported",
    favorite: false,
    archived: false,
    algorithm: parseAlgorithm(value.algorithm),
    digits,
    period,
  };
}

function enforceTextLimit(text: string) {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_FILE_BYTES) {
    throw new Error("This file is larger than the 5 MiB import limit");
  }
  return text.replace(/^\uFEFF/u, "");
}

export function parseTwoFAuthExport(input: string): ImportBatch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(enforceTextLimit(input));
  } catch {
    throw new Error("This does not look like a valid 2FAuth JSON export");
  }
  if (!isRecord(parsed) || typeof parsed.app !== "string" || !parsed.app.startsWith("2fauth_") || parsed.schema !== 1 || !Array.isArray(parsed.data)) {
    throw new Error("This does not look like a 2FAuth schema 1 export");
  }
  if (parsed.data.length > MAX_IMPORT_ACCOUNTS) throw new Error("This export contains more than 1,000 accounts");

  return {
    source: "2FAuth",
    items: parsed.data.map((entry, index) => {
      const record = isRecord(entry) ? entry : {};
      const label = [record.service, record.account].filter((part) => typeof part === "string").join(" — ") || `Account ${index + 1}`;
      try {
        return { key: `2fauth-${index}`, label, account: parseTotpRecord(entry) };
      } catch (error) {
        return { key: `2fauth-${index}`, label, issue: error instanceof Error ? error.message : "Account is invalid" };
      }
    }),
  };
}

export function parseOtpAuthList(input: string): ImportBatch {
  const lines = enforceTextLimit(input).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error("No OTPAuth links were found");
  if (lines.length > MAX_IMPORT_ACCOUNTS) throw new Error("This list contains more than 1,000 accounts");

  return {
    source: "OTPAuth list",
    items: lines.map((line, index) => {
      if (line.length > 8_192) return { key: `uri-${index}`, label: `Line ${index + 1}`, issue: "Link exceeds the 8 KiB limit" };
      try {
        const parsed = parseOtpAuthUri(line);
        return {
          key: `uri-${index}`,
          label: `${parsed.issuer || "No issuer"} — ${parsed.account}`,
          account: {
            service: parsed.issuer || "Imported account",
            identity: parsed.account,
            secret: parsed.secret,
            group: "Imported",
            favorite: false,
            archived: false,
            algorithm: parsed.algorithm,
            digits: parsed.digits,
            period: parsed.period,
          },
        };
      } catch (error) {
        return { key: `uri-${index}`, label: `Line ${index + 1}`, issue: error instanceof Error ? error.message : "Link is invalid" };
      }
    }),
  };
}
