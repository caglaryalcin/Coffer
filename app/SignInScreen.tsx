"use client";

import { type FormEvent, useId, useState } from "react";

export type AccessMode = "sign-in" | "create-account";

export type SignInScreenProps = {
  status: "loading" | "access" | "locking";
  busy: boolean;
  error: string | null;
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
  onSignIn,
  onCreateAccount,
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

  const isLocking = status === "locking";
  const isCreateAccount = mode === "create-account";
  const isBusy = busy || submitting;
  const visibleError = error ?? submissionError;

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
    setMode(nextMode);
    setPassword("");
    setConfirmation("");
    setFieldErrors({});
    setSubmissionError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy || status !== "access") return;

    const fields = { name, email, password, confirmation };
    const nextErrors = validateAccessFields(mode, fields);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmissionError(null);
    setSubmitting(true);

    try {
      if (isCreateAccount) {
        await onCreateAccount({
          name: name.trim(),
          email: email.trim(),
          password,
          rememberLogin,
        });
      } else {
        await onSignIn({ email: email.trim(), password, rememberLogin });
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

        <div id={ids.accessPanel}>
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

          <form className="transfer-form" onSubmit={submit} noValidate>
            {isCreateAccount && (
              <label htmlFor={ids.name}>
                <span>Display name</span>
                <input
                  id={ids.name}
                  name="name"
                  type="text"
                  value={name}
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
                value={email}
                maxLength={254}
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete={isCreateAccount ? "email" : "username"}
                disabled={isBusy}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={describedBy(isCreateAccount ? ids.emailHint : undefined, ids.emailError, fieldErrors.email)}
                onChange={(event) => {
                  setEmail(event.target.value);
                  clearFieldError("email");
                }}
              />
              {isCreateAccount && <small id={ids.emailHint}>Used to identify your vault; Coffer cannot use it to reset your password.</small>}
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
                {!isBusy && <span aria-hidden="true">→</span>}
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
