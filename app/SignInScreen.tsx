"use client";

import { type FormEvent, useId, useState } from "react";
import type { OidcClientState } from "../lib/vault-api";

export type AccessMode = "sign-in" | "create-account";

export type SignInScreenProps = {
  status: "loading" | "access" | "locking";
  busy: boolean;
  error: string | null;
  accountCreationEnabled: boolean;
  passwordRecoveryEnabled: boolean;
  recoveryToken: string | null;
  oidc: OidcClientState;
  onSignIn: (details: {
    email: string;
    password: string;
    rememberLogin: boolean;
  }) => Promise<void> | void;
  onCreateAccount: (details: {
    name: string;
    email: string;
    password: string;
    rememberLogin: boolean;
  }) => Promise<void> | void;
  onOidcSignOut: () => Promise<void> | void;
  onRequestPasswordRecovery: (email: string) => Promise<{ accepted: true; previewUrl?: string }>;
  onResetPassword: (token: string, recoveryKey: string, newPassword: string) => Promise<void>;
};

export type AccessField = "name" | "email" | "password" | "confirmation";
export type AccessFieldErrors = Partial<Record<AccessField, string>>;

export type AccessFields = {
  name: string;
  email: string;
  password: string;
  confirmation: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
export const MINIMUM_PASSWORD_LENGTH = 12;
export const MAXIMUM_PASSWORD_LENGTH = 256;

function ArrowRightIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 12h14" />
      <path d="m14 7 5 5-5 5" />
    </svg>
  );
}

export function validateAccessFields(
  mode: AccessMode,
  fields: AccessFields,
): AccessFieldErrors {
  const errors: AccessFieldErrors = {};
  const name = fields.name.trim();
  const email = fields.email.trim();

  if (mode === "create-account") {
    if (!name) errors.name = "Enter the name you want Coffer to display.";
    else if (name.length > 80) errors.name = "Use a name with 80 characters or fewer.";
  }

  if (!email) errors.email = "Enter your email address.";
  else if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  if (!fields.password) {
    errors.password = mode === "create-account"
      ? "Create a password."
      : "Enter your password.";
  } else if (mode === "create-account") {
    const passwordLength = [...fields.password].length;
    if (passwordLength < MINIMUM_PASSWORD_LENGTH) {
      errors.password = `Use at least ${MINIMUM_PASSWORD_LENGTH} characters.`;
    } else if (passwordLength > MAXIMUM_PASSWORD_LENGTH) {
      errors.password = `Use ${MAXIMUM_PASSWORD_LENGTH} characters or fewer.`;
    }
  }

  if (mode === "create-account") {
    if (!fields.confirmation) errors.confirmation = "Confirm your password.";
    else if (fields.confirmation !== fields.password) {
      errors.confirmation = "The passwords do not match.";
    }
  }

  return errors;
}

export default function SignInScreen({
  status,
  busy,
  error,
  accountCreationEnabled,
  passwordRecoveryEnabled,
  recoveryToken,
  oidc,
  onSignIn,
  onCreateAccount,
  onOidcSignOut,
  onRequestPasswordRecovery,
  onResetPassword,
}: SignInScreenProps) {
  const id = useId();
  const [mode, setMode] = useState<AccessMode>("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [rememberLogin, setRememberLogin] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<AccessFieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [recoverySent, setRecoverySent] = useState(false);
  const [recoveryPreviewUrl, setRecoveryPreviewUrl] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [recoveryComplete, setRecoveryComplete] = useState(false);

  const isLocking = status === "locking";
  const isCreateAccount = accountCreationEnabled && mode === "create-account";
  const activeMode: AccessMode = isCreateAccount ? "create-account" : "sign-in";
  const isBusy = busy || submitting;
  const visibleError = error ?? submissionError;
  const effectiveEmail = oidc.identity?.email ?? email;
  const effectiveName = name || oidc.identity?.name || "";

  const ids = {
    title: `${id}-title`,
    accessPanel: `${id}-access-panel`,
    formTitle: `${id}-form-title`,
    formDescription: `${id}-form-description`,
    formError: `${id}-form-error`,
    name: `${id}-name`,
    nameHint: `${id}-name-hint`,
    nameError: `${id}-name-error`,
    email: `${id}-email`,
    emailHint: `${id}-email-hint`,
    emailError: `${id}-email-error`,
    password: `${id}-password`,
    passwordHint: `${id}-password-hint`,
    passwordError: `${id}-password-error`,
    confirmation: `${id}-confirmation`,
    confirmationHint: `${id}-confirmation-hint`,
    confirmationError: `${id}-confirmation-error`,
    rememberLogin: `${id}-remember-login`,
    rememberLoginHint: `${id}-remember-login-hint`,
  };

  const clearFieldError = (field: AccessField) => {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setSubmissionError(null);
  };

  const describedBy = (hintId: string | undefined, errorId: string, fieldError?: string) => {
    const references = [hintId, fieldError ? errorId : undefined].filter(Boolean);
    return references.length > 0 ? references.join(" ") : undefined;
  };

  const selectMode = (nextMode: AccessMode) => {
    if (isBusy || nextMode === mode) return;
    if (nextMode === "create-account" && !accountCreationEnabled) return;
    setMode(nextMode);
    setPassword("");
    setConfirmation("");
    setFieldErrors({});
    setSubmissionError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy || status !== "access") return;

    const fields = { name: effectiveName, email: effectiveEmail, password, confirmation };
    const nextErrors = validateAccessFields(activeMode, fields);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmissionError(null);
    setSubmitting(true);

    try {
      if (isCreateAccount) {
        await onCreateAccount({
          name: effectiveName.trim(),
          email: effectiveEmail.trim(),
          password,
          rememberLogin,
        });
      } else {
        await onSignIn({ email: effectiveEmail.trim(), password, rememberLogin });
      }
      setPassword("");
      setConfirmation("");
    } catch {
      setSubmissionError(
        isCreateAccount
          ? "Coffer could not create your account. Please try again."
          : "Coffer could not sign you in. Check your details and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const requestRecovery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy) return;
    const normalizedEmail = effectiveEmail.trim();
    if (!normalizedEmail || normalizedEmail.length > 254 || !EMAIL_PATTERN.test(normalizedEmail)) {
      setSubmissionError("Enter a valid email address.");
      return;
    }
    setSubmitting(true);
    setSubmissionError(null);
    try {
      const result = await onRequestPasswordRecovery(normalizedEmail);
      setRecoveryPreviewUrl(result.previewUrl ?? null);
      setRecoverySent(true);
    } catch (caught) {
      setSubmissionError(caught instanceof Error ? caught.message : "Coffer could not send the recovery email.");
    } finally {
      setSubmitting(false);
    }
  };

  const resetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy || !recoveryToken) return;
    const passwordLength = Array.from(newPassword).length;
    if (!recoveryKey.trim()) {
      setSubmissionError("Enter your recovery key.");
      return;
    }
    if (passwordLength < MINIMUM_PASSWORD_LENGTH || passwordLength > MAXIMUM_PASSWORD_LENGTH) {
      setSubmissionError(`Use ${MINIMUM_PASSWORD_LENGTH} to ${MAXIMUM_PASSWORD_LENGTH} characters for the new password.`);
      return;
    }
    if (newPassword !== newPasswordConfirmation) {
      setSubmissionError("The new passwords do not match.");
      return;
    }
    setSubmitting(true);
    setSubmissionError(null);
    try {
      await onResetPassword(recoveryToken, recoveryKey.trim(), newPassword);
      setRecoveryKey("");
      setNewPassword("");
      setNewPasswordConfirmation("");
      setRecoveryComplete(true);
    } catch (caught) {
      setSubmissionError(caught instanceof Error ? caught.message : "The password could not be reset.");
    } finally {
      setSubmitting(false);
    }
  };

  if (status === "loading" || isLocking) {
    return (
      <main className="transfer-center auth-screen auth-loading-screen theme-dark" aria-labelledby={ids.title}>
        <section className="transfer-panel auth-loading" role="status" aria-live="polite">
          <div className={`auth-brand${isCreateAccount ? "" : " compact"}`}>
            <span className="brand-mark" aria-hidden="true">C</span>
            <span>Coffer</span>
          </div>
          <span className="auth-loading-indicator" aria-hidden="true" />
          <h1 id={ids.title}>{isLocking ? "Locking your vault" : "Opening Coffer"}</h1>
          <p className="subtitle">
            {isLocking
              ? "Securing pending encrypted changes and clearing this browser session…"
              : error
                ? "Reload this page after the vault server is available."
                : "Checking your encrypted vault session…"}
          </p>
          {error && <div className="transfer-error" role="alert"><span aria-hidden="true">!</span>{error}</div>}
        </section>
      </main>
    );
  }

  if (recoveryToken) {
    return (
      <main className="transfer-center auth-screen theme-dark" aria-label="Reset Coffer password">
        <header className="transfer-heading auth-intro">
          <div className="auth-intro-copy">
            <div className="auth-brand"><span className="brand-mark" aria-hidden="true">C</span><span>Coffer</span></div>
            <p className="auth-tagline">Your codes. Yours alone.</p>
          </div>
        </header>
        <section className="transfer-panel auth-access-panel recovery-access-panel" aria-labelledby={ids.formTitle} aria-busy={isBusy}>
          <div className="review-head auth-form-heading">
            <div>
              <h2 id={ids.formTitle}>Reset vault password</h2>
              <p>Use the recovery key you saved when account recovery was enabled.</p>
            </div>
          </div>
          {visibleError && <div className="transfer-error" role="alert"><span aria-hidden="true">!</span>{visibleError}</div>}
          <form className="transfer-form" onSubmit={(event) => void resetPassword(event)} noValidate>
            <label>
              <span>Recovery key</span>
              <input
                type="text"
                value={recoveryKey}
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                disabled={isBusy}
                onChange={(event) => { setRecoveryKey(event.target.value); setSubmissionError(null); }}
              />
            </label>
            <label>
              <span>New password</span>
              <input type="password" value={newPassword} autoComplete="new-password" disabled={isBusy} onChange={(event) => { setNewPassword(event.target.value); setSubmissionError(null); }} />
              <small>Use {MINIMUM_PASSWORD_LENGTH} to {MAXIMUM_PASSWORD_LENGTH} characters.</small>
            </label>
            <label>
              <span>Confirm new password</span>
              <input type="password" value={newPasswordConfirmation} autoComplete="new-password" disabled={isBusy} onChange={(event) => { setNewPasswordConfirmation(event.target.value); setSubmissionError(null); }} />
            </label>
            <div className="auth-recovery-warning" role="note">
              <span className="mini-lock" aria-hidden="true" />
              <div><strong>Your vault data stays encrypted</strong><p>The email link confirms the request. Only your recovery key can unlock the existing vault key.</p></div>
            </div>
            <div className="password-change-actions recovery-form-actions">
              <button type="button" disabled={isBusy} onClick={() => { window.location.href = window.location.pathname; }}>Cancel</button>
              <button className="transfer-primary" type="submit" disabled={isBusy}>{isBusy ? "Resetting password…" : "Reset password"}</button>
            </div>
          </form>
        </section>
      </main>
    );
  }

  if (forgotPassword) {
    return (
      <main className="transfer-center auth-screen theme-dark" aria-label="Forgot Coffer password">
        <header className="transfer-heading auth-intro">
          <div className="auth-intro-copy">
            <div className="auth-brand"><span className="brand-mark" aria-hidden="true">C</span><span>Coffer</span></div>
            <p className="auth-tagline">Your codes. Yours alone.</p>
          </div>
        </header>
        <section className="transfer-panel auth-access-panel recovery-access-panel" aria-labelledby={ids.formTitle} aria-busy={isBusy}>
          <div className="review-head auth-form-heading">
            <div>
              <h2 id={ids.formTitle}>{recoverySent ? "Check your email" : "Forgot your password?"}</h2>
              <p>{recoverySent ? "If recovery is configured for this account, a reset link has been sent." : "We will email a time-limited link. You will also need your saved recovery key."}</p>
            </div>
          </div>
          {visibleError && <div className="transfer-error" role="alert"><span aria-hidden="true">!</span>{visibleError}</div>}
          {recoverySent ? (
            <div className="recovery-sent-content">
              <div className="auth-recovery-warning" role="note"><span className="mini-lock" aria-hidden="true" /><div><strong>The email cannot decrypt your vault</strong><p>Keep your recovery key private. Coffer support will never ask you to send it.</p></div></div>
              {recoveryPreviewUrl && <a className="transfer-primary recovery-preview-link" href={recoveryPreviewUrl}>Open development recovery link</a>}
              <button className="password-change-toggle" type="button" onClick={() => { setForgotPassword(false); setRecoverySent(false); setRecoveryPreviewUrl(null); }}>Back to sign in</button>
            </div>
          ) : (
            <form className="transfer-form" onSubmit={(event) => void requestRecovery(event)} noValidate>
              <label htmlFor={ids.email}>
                <span>Email</span>
                <input id={ids.email} type="email" value={effectiveEmail} autoComplete="email" disabled={isBusy || Boolean(oidc.identity)} onChange={(event) => { setEmail(event.target.value); setSubmissionError(null); }} />
              </label>
              <div className="password-change-actions recovery-form-actions">
                <button type="button" disabled={isBusy} onClick={() => { setForgotPassword(false); setSubmissionError(null); }}>Back</button>
                <button className="transfer-primary" type="submit" disabled={isBusy}>{isBusy ? "Sending…" : "Send recovery email"}</button>
              </div>
            </form>
          )}
        </section>
      </main>
    );
  }

  if (oidc.enabled && !oidc.authenticated) {
    return (
      <main className="transfer-center auth-screen theme-dark" aria-label="Coffer sign in">
        <header className="transfer-heading auth-intro">
          <div className="auth-intro-copy">
            <div className="auth-brand">
              <span className="brand-mark" aria-hidden="true">C</span>
              <span>Coffer</span>
            </div>
            <p className="auth-tagline">Your codes. Yours alone.</p>
          </div>
        </header>
        <section
          className="transfer-panel auth-access-panel oidc-access-panel"
          style={{ maxWidth: 640, margin: "36px auto 0" }}
          aria-labelledby={ids.formTitle}
        >
          <div className="review-head auth-form-heading">
            <div>
              <h2 id={ids.formTitle}>Sign in to Coffer</h2>
              <p>Continue with your organization&apos;s identity provider.</p>
            </div>
          </div>
          {visibleError && (
            <div className="transfer-error" id={ids.formError} role="alert">
              <span aria-hidden="true">!</span>
              {visibleError}
            </div>
          )}
          {recoveryComplete && (
            <div className="auth-success-notice" role="status">
              Password reset complete. Sign in with your new password, then create a new recovery key.
            </div>
          )}
          <a className="transfer-primary oidc-login-button" href="/api/auth/oidc/login">
            Continue with {oidc.providerName ?? "OpenID Connect"}
            <ArrowRightIcon className="auth-submit-icon" />
          </a>
          <p className="oidc-vault-note">
            After signing in, enter your vault password to decrypt your data in this browser.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main
      className="transfer-center auth-screen theme-dark"
      aria-label={isCreateAccount ? "Create Coffer account" : "Coffer sign in"}
    >
      <header className="transfer-heading auth-intro">
        <div className="auth-intro-copy">
          <div className="auth-brand">
            <span className="brand-mark" aria-hidden="true">C</span>
            <span>Coffer</span>
          </div>
          <p className="auth-tagline">Your codes. Yours alone.</p>
        </div>
      </header>

      <section
        className="transfer-panel auth-access-panel"
        style={{ maxWidth: 640, margin: "36px auto 0" }}
        aria-label={isCreateAccount ? undefined : "Sign in"}
        aria-labelledby={isCreateAccount ? ids.formTitle : undefined}
        aria-describedby={isCreateAccount ? ids.formDescription : undefined}
        aria-busy={isBusy}
      >
        {accountCreationEnabled && (
          <div className="auth-mode-tabs" role="group" aria-label="Account access">
            <button
              type="button"
              aria-pressed={!isCreateAccount}
              disabled={isBusy}
              onClick={() => selectMode("sign-in")}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={isCreateAccount}
              disabled={isBusy}
              onClick={() => selectMode("create-account")}
            >
              Create account
            </button>
          </div>
        )}

        <div id={ids.accessPanel}>
          {oidc.identity && (
            <div className="oidc-identity" role="status">
              <div>
                <strong>{oidc.identity.name ?? oidc.identity.email}</strong>
                {oidc.identity.name && <span>{oidc.identity.email}</span>}
              </div>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  setSubmitting(true);
                  setSubmissionError(null);
                  void Promise.resolve(onOidcSignOut())
                    .catch(() => setSubmissionError("Coffer could not end the identity session."))
                    .finally(() => setSubmitting(false));
                }}
              >
                Use another account
              </button>
            </div>
          )}
          {isCreateAccount && (
            <div className="review-head auth-form-heading">
              <div>
                <h2 id={ids.formTitle}>Create an encrypted vault</h2>
                <p id={ids.formDescription}>
                  Your password encrypts your vault before it leaves this browser.
                </p>
              </div>
            </div>
          )}

          {visibleError && (
            <div className="transfer-error" id={ids.formError} role="alert">
              <span aria-hidden="true">!</span>
              {visibleError}
            </div>
          )}
          {recoveryComplete && (
            <div className="auth-success-notice" role="status">
              Password reset complete. Sign in with your new password, then create a new recovery key.
            </div>
          )}

          <form className="transfer-form" onSubmit={submit} noValidate>
            {isCreateAccount && (
              <label htmlFor={ids.name}>
                <span>Display name</span>
                <input
                  id={ids.name}
                  name="name"
                  type="text"
                  value={effectiveName}
                  maxLength={80}
                  autoComplete="name"
                  disabled={isBusy}
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={describedBy(ids.nameHint, ids.nameError, fieldErrors.name)}
                  onChange={(event) => {
                    setName(event.target.value);
                    clearFieldError("name");
                  }}
                />
                <small id={ids.nameHint}>Shown in your Coffer profile.</small>
                {fieldErrors.name && <small className="form-error" id={ids.nameError}>{fieldErrors.name}</small>}
              </label>
            )}

            <label htmlFor={ids.email}>
              <span>Email</span>
              <input
                id={ids.email}
                name="email"
                type="email"
                value={effectiveEmail}
                maxLength={254}
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete={isCreateAccount ? "email" : "username"}
                disabled={isBusy || Boolean(oidc.identity)}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={describedBy(isCreateAccount ? ids.emailHint : undefined, ids.emailError, fieldErrors.email)}
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearFieldError("email");
                }}
              />
              {isCreateAccount && <small id={ids.emailHint}>Used to identify your vault and receive recovery emails if you enable account recovery.</small>}
              {fieldErrors.email && <small className="form-error" id={ids.emailError}>{fieldErrors.email}</small>}
            </label>

            <label htmlFor={ids.password}>
              <span>Password</span>
              <input
                id={ids.password}
                name="password"
                type="password"
                value={password}
                minLength={isCreateAccount ? MINIMUM_PASSWORD_LENGTH : undefined}
                maxLength={MAXIMUM_PASSWORD_LENGTH}
                autoComplete={isCreateAccount ? "new-password" : "current-password"}
                disabled={isBusy}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={describedBy(isCreateAccount ? ids.passwordHint : undefined, ids.passwordError, fieldErrors.password)}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearFieldError("password");
                }}
              />
              {isCreateAccount && <small id={ids.passwordHint}>Use at least {MINIMUM_PASSWORD_LENGTH} characters. A unique, memorable passphrase works well.</small>}
              {fieldErrors.password && <small className="form-error" id={ids.passwordError}>{fieldErrors.password}</small>}
            </label>

            {!isCreateAccount && passwordRecoveryEnabled && (
              <button
                className="forgot-password-link"
                type="button"
                disabled={isBusy}
                onClick={() => {
                  setForgotPassword(true);
                  setSubmissionError(null);
                  setFieldErrors({});
                }}
              >Forgot password?</button>
            )}

            {isCreateAccount && (
              <label htmlFor={ids.confirmation}>
                <span>Confirm password</span>
                <input
                  id={ids.confirmation}
                  name="password-confirmation"
                  type="password"
                  value={confirmation}
                  minLength={MINIMUM_PASSWORD_LENGTH}
                  maxLength={MAXIMUM_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  disabled={isBusy}
                  aria-invalid={Boolean(fieldErrors.confirmation)}
                  aria-describedby={describedBy(ids.confirmationHint, ids.confirmationError, fieldErrors.confirmation)}
                  onChange={(event) => {
                    setConfirmation(event.target.value);
                    clearFieldError("confirmation");
                  }}
                />
                <small id={ids.confirmationHint}>Enter the same password again.</small>
                {fieldErrors.confirmation && (
                  <small className="form-error" id={ids.confirmationError}>{fieldErrors.confirmation}</small>
                )}
              </label>
            )}

            <div className="auth-remember-login">
              <input
                id={ids.rememberLogin}
                name="remember-login"
                type="checkbox"
                checked={rememberLogin}
                disabled={isBusy}
                aria-describedby={ids.rememberLoginHint}
                onChange={(event) => setRememberLogin(event.target.checked)}
              />
              <div>
                <label htmlFor={ids.rememberLogin}>Remember this browser</label>
                <small id={ids.rememberLoginHint}>Do not ask for login information on this browser for 30 days.</small>
              </div>
            </div>

            <div className="auth-recovery-warning" role="note">
              <span className="mini-lock" aria-hidden="true" />
              <div>
                <strong>Your password cannot be recovered</strong>
                <p>
                  {isCreateAccount
                    ? "Coffer cannot reset it or decrypt your vault without it. Store it somewhere safe."
                    : "Coffer cannot reset it or decrypt your vault without it."}
                </p>
              </div>
            </div>

            <div className="transfer-footer auth-submit-footer">
              <aside className="local-only-note" role="note" aria-label="Browser-encrypted vault">
                <span className="local-note-icon" aria-hidden="true" />
                Encrypted in your browser<br />
                <small>The server stores ciphertext only</small>
              </aside>
              <button className="transfer-primary" type="submit" disabled={isBusy}>
                {isBusy
                  ? (isCreateAccount ? "Creating account…" : "Signing in…")
                  : (isCreateAccount ? "Create account" : "Sign in")}
                {!isBusy && <ArrowRightIcon className="auth-submit-icon" />}
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
