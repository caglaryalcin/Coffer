import { createHash, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { readSmtpSettings, type SmtpRuntimeSettings } from "./smtp-settings-store";

const TOKEN_TTL_MS = 15 * 60 * 1_000;
const REQUEST_WINDOW_MS = 60 * 60 * 1_000;
const MAX_REQUESTS_PER_WINDOW = 5;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

type RecoveryTokenRecord = {
  identifier: string;
  expiresAt: number;
};

export class PasswordRecoveryError extends Error {
  constructor(
    readonly code: "not_configured" | "invalid_token" | "rate_limited" | "delivery_failed",
    message: string,
  ) {
    super(message);
    this.name = "PasswordRecoveryError";
  }
}
export type PasswordRecoveryDelivery = {
  previewUrl?: string;
};

function devModeEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.COFFER_RECOVERY_DEV_MODE === "1";
}

export function passwordRecoveryEnabled(): boolean {
  return devModeEnabled() || readSmtpSettings().enabled;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function smtpTransport(config: SmtpRuntimeSettings) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user && config.password
      ? { user: config.user, pass: config.password }
      : undefined,
    requireTLS: !config.secure,
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 10_000,
  });
}

function smtpDeliveryFailureMessage(caught: unknown, fallback: string): string {
  if (!caught || typeof caught !== "object") return fallback;
  const error = caught as {
    code?: unknown;
    command?: unknown;
    responseCode?: unknown;
    response?: unknown;
  };
  const code = typeof error.code === "string" ? error.code : "";
  const responseCode = typeof error.responseCode === "number" ? error.responseCode : null;
  const response = typeof error.response === "string"
    ? error.response.replace(/[\r\n\t]+/gu, " ").trim().slice(0, 320)
    : "";

  let reason = "";
  if (code === "EAUTH") {
    reason = "Authentication was rejected. Check the username and app password.";
  } else if (code === "ETIMEDOUT" || code === "ESOCKET" || code === "ECONNECTION") {
    reason = "The SMTP server could not be reached. Check the host, port, TLS mode, and firewall.";
  } else if (code === "EENVELOPE") {
    reason = "The SMTP server rejected the sender or recipient address.";
  }

  const technical = [
    responseCode ? `SMTP ${responseCode}` : "",
    code && !reason ? code : "",
    response,
  ].filter(Boolean).join(": ");
  return [fallback, reason, technical].filter(Boolean).join(" ");
}

export async function sendSmtpTestEmail(
  config: SmtpRuntimeSettings,
  recipient: string,
): Promise<void> {
  if (!config.enabled) {
    throw new PasswordRecoveryError("not_configured", "SMTP must be enabled before it can be tested.");
  }
  try {
    await smtpTransport(config).sendMail({
      from: config.from,
      to: recipient,
      subject: "Coffer SMTP test",
      text: [
        "Your Coffer SMTP configuration is working.",
        "",
        "This message was requested from Settings → Email delivery.",
      ].join("\n"),
      html: "<p><strong>Your Coffer SMTP configuration is working.</strong></p><p>This message was requested from Settings → Email delivery.</p>",
    });
  } catch (caught) {
    throw new PasswordRecoveryError(
      "delivery_failed",
      smtpDeliveryFailureMessage(
        caught,
        "Coffer could not send the SMTP test email.",
      ),
    );
  }
}

export class PasswordRecoveryService {
  private readonly tokens = new Map<string, RecoveryTokenRecord>();
  private readonly requests = new Map<string, number[]>();

  constructor(private readonly now: () => number = Date.now) {}

  async deliver(
    identifier: string,
    publicBaseUrl: string,
    rateKey: string,
  ): Promise<PasswordRecoveryDelivery> {
    if (!passwordRecoveryEnabled()) {
      throw new PasswordRecoveryError("not_configured", "Password recovery email is not configured.");
    }
    this.recordRequest(rateKey, identifier);
    this.pruneTokens();

    const token = Buffer.from(randomBytes(32)).toString("base64url");
    const url = new URL("/", publicBaseUrl);
    url.searchParams.set("recovery", token);

    const config = readSmtpSettings();
    if (devModeEnabled() && !config.enabled) {
      this.tokens.set(tokenHash(token), { identifier, expiresAt: this.now() + TOKEN_TTL_MS });
      console.info(`[coffer] Development password recovery link for ${identifier}: ${url.toString()}`);
      return { previewUrl: url.toString() };
    }

    if (!config.enabled) {
      throw new PasswordRecoveryError("not_configured", "Password recovery email is not configured.");
    }
    try {
      await smtpTransport(config).sendMail({
        from: config.from,
        to: identifier,
        subject: "Reset your Coffer vault password",
        text: [
          "A password reset was requested for your Coffer vault.",
          "",
          `Open this link within 15 minutes: ${url.toString()}`,
          "",
          "You will also need the recovery key saved when account recovery was enabled.",
          "If you did not request this, you can ignore this message.",
        ].join("\n"),
        html: `<p>A password reset was requested for your Coffer vault.</p><p><a href="${url.toString()}">Reset your vault password</a></p><p>This link expires in 15 minutes. You will also need your saved recovery key.</p><p>If you did not request this, you can ignore this message.</p>`,
      });
    } catch (caught) {
      throw new PasswordRecoveryError(
        "delivery_failed",
        smtpDeliveryFailureMessage(caught, "Coffer could not send the recovery email."),
      );
    }
    this.tokens.set(tokenHash(token), { identifier, expiresAt: this.now() + TOKEN_TTL_MS });
    return {};
  }

  resolve(token: string): RecoveryTokenRecord {
    this.pruneTokens();
    if (!TOKEN_PATTERN.test(token)) {
      throw new PasswordRecoveryError("invalid_token", "The recovery link is invalid or expired.");
    }
    const record = this.tokens.get(tokenHash(token));
    if (!record || record.expiresAt <= this.now()) {
      throw new PasswordRecoveryError("invalid_token", "The recovery link is invalid or expired.");
    }
    return record;
  }

  consume(token: string): void {
    this.tokens.delete(tokenHash(token));
  }

  private recordRequest(rateKey: string, identifier: string): void {
    const key = `${rateKey.slice(0, 128)}:${createHash("sha256").update(identifier).digest("base64url")}`;
    const threshold = this.now() - REQUEST_WINDOW_MS;
    const recent = (this.requests.get(key) ?? []).filter((createdAt) => createdAt > threshold);
    if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
      throw new PasswordRecoveryError("rate_limited", "Too many recovery emails were requested. Try again later.");
    }
    recent.push(this.now());
    this.requests.set(key, recent);
    if (this.requests.size > 1_024) {
      const oldest = this.requests.keys().next().value as string | undefined;
      if (oldest && oldest !== key) this.requests.delete(oldest);
    }
  }

  private pruneTokens(): void {
    const now = this.now();
    for (const [hash, record] of this.tokens) {
      if (record.expiresAt <= now) this.tokens.delete(hash);
    }
    while (this.tokens.size > 1_024) {
      const oldest = this.tokens.keys().next().value as string | undefined;
      if (!oldest) break;
      this.tokens.delete(oldest);
    }
  }
}
