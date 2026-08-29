"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import type { VaultProfile } from "../lib/vault-model";
import { languages, useI18n, type CofferLanguage } from "./I18nProvider";
import { PROFILE_IMAGE_ACCEPT, prepareProfileImage } from "./profile-image";

export type UserProfile = VaultProfile;
export type UserProfilePatch = Partial<Pick<UserProfile, "name" | "avatarDataUrl">>;
export type ProfileMutationResult = boolean | void;

export const DISPLAY_NAME_MIN_LENGTH = 2;
export const DISPLAY_NAME_MAX_LENGTH = 80;

function containsControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

export function validateDisplayName(value: string): string | null {
  if (containsControlCharacters(value)) {
    return "Display name cannot contain control characters.";
  }
  const length = value.trim().length;
  if (length < DISPLAY_NAME_MIN_LENGTH) {
    return `Enter a display name with at least ${DISPLAY_NAME_MIN_LENGTH} characters.`;
  }
  if (length > DISPLAY_NAME_MAX_LENGTH) {
    return `Use a display name with ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

export type SettingsCenterProps = {
  profile: UserProfile;
  autoLockMinutes: number;
  lockWhenHidden: boolean;
  clearClipboard: boolean;
  allowAccountCreation: boolean;
  onProfileChange: (
    patch: UserProfilePatch,
  ) => ProfileMutationResult | Promise<ProfileMutationResult>;
  onAutoLockMinutesChange: (minutes: number) => void;
  onLockWhenHiddenChange: (enabled: boolean) => void;
  onClearClipboardChange: (enabled: boolean) => void;
  onAllowAccountCreationChange: (enabled: boolean) => void | Promise<void>;
  onNotice: (message: string) => void;
  onSignOut: () => void;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  onDeleteAccount: (password: string) => Promise<void>;
};

type PasswordErrorField = "current" | "new" | "confirmation" | "form" | null;

const MIN_PASSWORD_CHARACTERS = 12;
const MAX_PASSWORD_CHARACTERS = 256;

export default function SettingsCenter({
  profile,
  autoLockMinutes,
  lockWhenHidden,
  clearClipboard,
  allowAccountCreation,
  onProfileChange,
  onAutoLockMinutesChange,
  onLockWhenHiddenChange,
  onClearClipboardChange,
  onAllowAccountCreationChange,
  onNotice,
  onSignOut,
  onChangePassword,
  onDeleteAccount,
}: SettingsCenterProps) {
  const { language, setLanguage } = useI18n();
  const [name, setName] = useState(profile.name);
  const [profileNameSource, setProfileNameSource] = useState(profile.name);
  const [error, setError] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordExpanded, setPasswordExpanded] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordErrorField, setPasswordErrorField] = useState<PasswordErrorField>(null);
  const [instanceSettingsBusy, setInstanceSettingsBusy] = useState(false);
  const [instanceSettingsError, setInstanceSettingsError] = useState("");
  const [deleteExpanded, setDeleteExpanded] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const passwordConfirmationRef = useRef<HTMLInputElement>(null);
  const passwordToggleRef = useRef<HTMLButtonElement>(null);
  const restorePasswordToggleFocusRef = useRef(false);
  const deletePasswordRef = useRef<HTMLInputElement>(null);
  const deleteToggleRef = useRef<HTMLButtonElement>(null);
  const restoreDeleteToggleFocusRef = useRef(false);

  useEffect(() => {
    if (passwordExpanded) {
      currentPasswordRef.current?.focus();
      return;
    }
    if (restorePasswordToggleFocusRef.current) {
      restorePasswordToggleFocusRef.current = false;
      passwordToggleRef.current?.focus();
    }
  }, [passwordExpanded]);

  useEffect(() => {
    if (deleteExpanded) {
      deletePasswordRef.current?.focus();
      return;
    }
    if (restoreDeleteToggleFocusRef.current) {
      restoreDeleteToggleFocusRef.current = false;
      deleteToggleRef.current?.focus();
    }
  }, [deleteExpanded]);

  if (profile.name !== profileNameSource) {
    setProfileNameSource(profile.name);
    setName(profile.name);
  }

  const applyProfilePatch = async (patch: UserProfilePatch): Promise<boolean> => {
    const result = await onProfileChange(patch);
    return result !== false;
  };

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (avatarBusy || profileBusy) return;
    setError("");
    const nameError = validateDisplayName(name);
    if (nameError) {
      setError(nameError);
      return;
    }

    setProfileBusy(true);
    try {
      const applied = await applyProfilePatch({ name: name.trim() });
      if (!applied) {
        setError("The profile could not be updated while the vault is unavailable.");
        return;
      }
      onNotice("Profile updated.");
    } catch {
      setError("Coffer could not update your profile. Please try again.");
    } finally {
      setProfileBusy(false);
    }
  };

  const changeProfilePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    setAvatarError("");
    setAvatarBusy(true);
    let avatarDataUrl: string;
    try {
      avatarDataUrl = await prepareProfileImage(file);
    } catch (imageError) {
      setAvatarError(imageError instanceof Error ? imageError.message : "The selected image could not be processed.");
      setAvatarBusy(false);
      return;
    }

    try {
      const applied = await applyProfilePatch({ avatarDataUrl });
      if (!applied) {
        setAvatarError("The profile photo could not be saved while the vault is unavailable.");
        return;
      }
      onNotice("Profile photo updated.");
    } catch {
      setAvatarError("Coffer could not save the profile photo. Please try again.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const removeProfilePhoto = async () => {
    if (avatarBusy || profileBusy) return;
    setAvatarError("");
    setAvatarBusy(true);
    try {
      const applied = await applyProfilePatch({ avatarDataUrl: null });
      if (!applied) {
        setAvatarError("The profile photo could not be removed while the vault is unavailable.");
        return;
      }
      onNotice("Profile photo removed.");
    } catch {
      setAvatarError("Coffer could not remove the profile photo. Please try again.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const clearPasswordError = () => {
    setPasswordError("");
    setPasswordErrorField(null);
  };

  const resetPasswordForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setPasswordConfirmation("");
    clearPasswordError();
  };

  const cancelPasswordChange = () => {
    if (passwordBusy) return;
    restorePasswordToggleFocusRef.current = true;
    resetPasswordForm();
    setPasswordExpanded(false);
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passwordBusy || avatarBusy || profileBusy || deleteBusy) return;
    clearPasswordError();

    if (!currentPassword) {
      setPasswordError("Enter your current password.");
      setPasswordErrorField("current");
      currentPasswordRef.current?.focus();
      return;
    }

    const newPasswordLength = Array.from(newPassword).length;
    if (newPasswordLength < MIN_PASSWORD_CHARACTERS) {
      setPasswordError(`Use a new password with at least ${MIN_PASSWORD_CHARACTERS} characters.`);
      setPasswordErrorField("new");
      newPasswordRef.current?.focus();
      return;
    }
    if (newPasswordLength > MAX_PASSWORD_CHARACTERS) {
      setPasswordError(`Use a new password with ${MAX_PASSWORD_CHARACTERS} characters or fewer.`);
      setPasswordErrorField("new");
      newPasswordRef.current?.focus();
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("Choose a new password that is different from your current password.");
      setPasswordErrorField("new");
      newPasswordRef.current?.focus();
      return;
    }
    if (passwordConfirmation !== newPassword) {
      setPasswordError("The new passwords do not match.");
      setPasswordErrorField("confirmation");
      passwordConfirmationRef.current?.focus();
      return;
    }

    setPasswordBusy(true);
    try {
      await onChangePassword(currentPassword, newPassword);
      resetPasswordForm();
      restorePasswordToggleFocusRef.current = true;
      setPasswordExpanded(false);
      onNotice("Password changed.");
    } catch (caught) {
      const message = caught instanceof Error
        ? caught.message
        : "Coffer could not change your password. Please try again.";
      const currentPasswordError = /(?:current password|incorrect|authentication)/iu.test(message);
      setCurrentPassword("");
      setNewPassword("");
      setPasswordConfirmation("");
      setPasswordError(message);
      setPasswordErrorField(currentPasswordError ? "current" : "form");
      window.requestAnimationFrame(() => currentPasswordRef.current?.focus());
    } finally {
      setPasswordBusy(false);
    }
  };

  const cancelAccountDeletion = () => {
    if (deleteBusy) return;
    restoreDeleteToggleFocusRef.current = true;
    setDeleteExpanded(false);
    setDeletePassword("");
    setDeleteConfirmation("");
    setDeleteError("");
  };

  const deleteAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (deleteBusy) return;
    setDeleteError("");
    if (deleteConfirmation.trim().toLowerCase() !== profile.email.trim().toLowerCase()) {
      setDeleteError("Enter your sign-in email exactly to confirm account deletion.");
      return;
    }
    if (!deletePassword) {
      setDeleteError("Enter your current password to delete this account.");
      return;
    }

    setDeleteBusy(true);
    try {
      await onDeleteAccount(deletePassword);
    } catch (caught) {
      setDeletePassword("");
      setDeleteError(caught instanceof Error
        ? caught.message
        : "Coffer could not delete this account. Please try again.");
      setDeleteBusy(false);
    }
  };

  const changeAccountCreation = async (event: ChangeEvent<HTMLInputElement>) => {
    const enabled = event.currentTarget.checked;
    if (instanceSettingsBusy || passwordBusy || avatarBusy || profileBusy || deleteBusy) return;
    setInstanceSettingsError("");
    setInstanceSettingsBusy(true);
    try {
      await onAllowAccountCreationChange(enabled);
      onNotice(enabled ? "Account creation enabled." : "Account creation disabled.");
    } catch {
      setInstanceSettingsError("Coffer could not update account creation. Please try again.");
    } finally {
      setInstanceSettingsBusy(false);
    }
  };

  return (
    <section className="settings-center" id="settings-root" aria-label="Settings" tabIndex={-1}>
      <div className="settings-layout">
        <div className="settings-stack">
          <section className="settings-card" id="profile-settings" aria-labelledby="profile-settings-title" tabIndex={-1}>
            <div className="settings-card-copy"><span className="settings-glyph profile-glyph" /><div><h2 id="profile-settings-title">Profile</h2></div></div>
            <form className="settings-form" onSubmit={(event) => void saveProfile(event)}>
              <div className="profile-photo-control" aria-busy={avatarBusy}>
                <span className={`profile-photo-preview${profile.avatarDataUrl ? " has-photo" : ""}`} aria-hidden="true">
                  {profile.avatarDataUrl
                    ? <img src={profile.avatarDataUrl} alt="" /> // eslint-disable-line @next/next/no-img-element -- encrypted data URLs cannot use the image optimizer
                    : <span>{profile.name.trim().charAt(0).toUpperCase() || "C"}</span>}
                </span>
                <div className="profile-photo-copy">
                  <strong>Profile photo</strong>
                  <small>PNG, JPEG, or WebP. Photos are cropped to a square and stored inside your encrypted vault.</small>
                  <div className="profile-photo-actions">
                    <input
                      ref={avatarInputRef}
                      className="profile-photo-input"
                      type="file"
                      accept={PROFILE_IMAGE_ACCEPT}
                      onChange={(event) => void changeProfilePhoto(event)}
                      disabled={avatarBusy || profileBusy || passwordBusy}
                      hidden
                      tabIndex={-1}
                    />
                    <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarBusy || profileBusy || passwordBusy}>
                      {avatarBusy ? "Processing…" : profile.avatarDataUrl ? "Change photo" : "Choose photo"}
                    </button>
                    {profile.avatarDataUrl && <button className="profile-photo-remove" type="button" onClick={() => void removeProfilePhoto()} disabled={avatarBusy || profileBusy || passwordBusy}>Remove</button>}
                  </div>
                  {avatarError && <p className="profile-photo-error" role="alert">{avatarError}</p>}
                </div>
              </div>
              <div className="profile-field-grid">
                <label className="profile-field"><span>Display name</span><input value={name} maxLength={DISPLAY_NAME_MAX_LENGTH} onChange={(event) => { setName(event.target.value); setError(""); }} autoComplete="name" disabled={passwordBusy} /></label>
                <label className="profile-field">
                  <span>Sign-in email</span>
                  <input type="email" value={profile.email} readOnly aria-readonly="true" autoComplete="username" />
                  <small>Your sign-in email identifies this encrypted vault and cannot be changed here.</small>
                </label>
              </div>
              {error && <p className="settings-error" role="alert">{error}</p>}
              <div className="settings-actions"><button type="submit" disabled={avatarBusy || profileBusy || passwordBusy}>{profileBusy ? "Saving…" : "Save profile"}</button></div>
            </form>
          </section>

          <section className="settings-card" id="language-settings" aria-labelledby="language-settings-title" tabIndex={-1}>
            <div className="settings-card-copy"><span className="settings-glyph language-glyph" aria-hidden="true" /><div><h2 id="language-settings-title">Language</h2><p>Read and write Coffer in your preferred language. This setting stays in this browser and updates the interface immediately.</p></div></div>
            <div className="settings-control-row">
              <div><strong>Language</strong><span>Choose the interface language.</span></div>
              <select
                aria-label="Language"
                value={language}
                onChange={(event) => setLanguage(event.target.value as CofferLanguage)}
                disabled={passwordBusy || avatarBusy || profileBusy || deleteBusy}
              >
                {languages.map((option) => (
                  <option key={option.code} value={option.code} data-i18n-ignore>
                    {`${option.flag} ${option.nativeLabel}`}
                  </option>
                ))}
              </select>
            </div>
          </section>

          <section className="settings-card" id="security-settings" aria-labelledby="security-settings-title" tabIndex={-1}>
            <div className="settings-card-copy"><span className="settings-glyph security-glyph" aria-hidden="true"><span className="security-glyph-lock" /></span><div><h2 id="security-settings-title">Security</h2><p>Change your vault password and control when the vault locks and how the clipboard behaves.</p></div></div>
            <div className="password-change-row">
              <div><strong id="vault-password-title">Vault password</strong><span id="vault-password-description">Choose a unique password that you do not use for another service.</span></div>
              {!passwordExpanded && (
                <button
                  ref={passwordToggleRef}
                  className="password-change-toggle"
                  type="button"
                  aria-expanded="false"
                  aria-controls="password-change-form"
                  aria-describedby="vault-password-description"
                  disabled={avatarBusy || profileBusy || deleteBusy}
                  onClick={() => {
                    restorePasswordToggleFocusRef.current = false;
                    resetPasswordForm();
                    setPasswordExpanded(true);
                  }}
                >Change password</button>
              )}
            </div>
            {passwordExpanded && (
              <form
                id="password-change-form"
                className="password-change-form"
                onSubmit={(event) => void changePassword(event)}
                aria-labelledby="vault-password-title"
                aria-describedby={`vault-password-description${passwordErrorField === "form" ? " password-change-error" : ""}`}
                aria-busy={passwordBusy}
              >
                <label className="visually-hidden" htmlFor="password-change-username">Sign-in email</label>
                <input
                  className="visually-hidden"
                  id="password-change-username"
                  name="username"
                  type="email"
                  value={profile.email}
                  autoComplete="username"
                  readOnly
                  tabIndex={-1}
                />
                <div className="password-change-fields">
                  <label htmlFor="current-vault-password">
                    <span>Current password</span>
                    <input
                      ref={currentPasswordRef}
                      id="current-vault-password"
                      name="current-password"
                      type="password"
                      value={currentPassword}
                      autoComplete="current-password"
                      disabled={passwordBusy}
                      aria-invalid={passwordErrorField === "current"}
                      aria-describedby={passwordErrorField === "current" ? "password-change-error" : undefined}
                      onChange={(event) => {
                        setCurrentPassword(event.target.value);
                        clearPasswordError();
                      }}
                    />
                  </label>
                  <label htmlFor="new-vault-password">
                    <span>New password</span>
                    <input
                      ref={newPasswordRef}
                      id="new-vault-password"
                      name="new-password"
                      type="password"
                      value={newPassword}
                      autoComplete="new-password"
                      disabled={passwordBusy}
                      aria-invalid={passwordErrorField === "new"}
                      aria-describedby={`new-vault-password-hint${passwordErrorField === "new" ? " password-change-error" : ""}`}
                      onChange={(event) => {
                        setNewPassword(event.target.value);
                        clearPasswordError();
                      }}
                    />
                    <small id="new-vault-password-hint">Use {MIN_PASSWORD_CHARACTERS} to {MAX_PASSWORD_CHARACTERS} characters.</small>
                  </label>
                  <label htmlFor="confirm-new-vault-password">
                    <span>Confirm new password</span>
                    <input
                      ref={passwordConfirmationRef}
                      id="confirm-new-vault-password"
                      name="new-password-confirmation"
                      type="password"
                      value={passwordConfirmation}
                      autoComplete="new-password"
                      disabled={passwordBusy}
                      aria-invalid={passwordErrorField === "confirmation"}
                      aria-describedby={passwordErrorField === "confirmation" ? "password-change-error" : undefined}
                      onChange={(event) => {
                        setPasswordConfirmation(event.target.value);
                        clearPasswordError();
                      }}
                    />
                  </label>
                </div>
                {passwordError && <p className="settings-error" id="password-change-error" role="alert">{passwordError}</p>}
                <div className="password-change-actions">
                  <button type="button" onClick={cancelPasswordChange} disabled={passwordBusy}>Cancel</button>
                  <button type="submit" disabled={passwordBusy || avatarBusy || profileBusy || deleteBusy} aria-live="polite">{passwordBusy ? "Changing password…" : "Change password"}</button>
                </div>
              </form>
            )}
            <div className="settings-control-row">
              <div><strong>Automatic lock</strong><span>Lock after continuous keyboard, pointer, or touch inactivity.</span></div>
              <select aria-label="Automatic lock delay" value={autoLockMinutes} onChange={(event) => onAutoLockMinutesChange(Number(event.target.value))} disabled={passwordBusy}>
                <option value="1">After 1 minute</option>
                <option value="5">After 5 minutes</option>
                <option value="15">After 15 minutes</option>
                <option value="30">After 30 minutes</option>
                <option value="0">Never</option>
              </select>
            </div>
            <div className="settings-toggle-row">
              <span><label htmlFor="lock-when-hidden">Lock immediately when Coffer is hidden</label><small>When enabled, switching tabs or minimizing the browser locks the vault immediately, regardless of the automatic lock delay.</small></span>
              <input id="lock-when-hidden" type="checkbox" checked={lockWhenHidden} onChange={(event) => onLockWhenHiddenChange(event.target.checked)} disabled={passwordBusy} />
            </div>
            <div className="settings-toggle-row">
              <span><label htmlFor="clear-copied-codes">Clear copied codes</label><small>Best-effort removal after 30 seconds if the clipboard still contains that code.</small></span>
              <input id="clear-copied-codes" type="checkbox" checked={clearClipboard} onChange={(event) => onClearClipboardChange(event.target.checked)} disabled={passwordBusy} />
            </div>
            <div className="settings-toggle-row">
              <span><label htmlFor="allow-account-creation">Allow new account registration</label><small>Keep the Create account tab available and allow new users to register on this instance.</small></span>
              <input id="allow-account-creation" type="checkbox" checked={allowAccountCreation} onChange={(event) => void changeAccountCreation(event)} disabled={passwordBusy || avatarBusy || profileBusy || deleteBusy || instanceSettingsBusy} />
            </div>
            {instanceSettingsError && <p className="settings-error" role="alert">{instanceSettingsError}</p>}
          </section>

          <section className="settings-about" id="about-settings" aria-labelledby="about-title" tabIndex={-1}>
            <div className="settings-about-panel">
              <div className="settings-card-copy"><span className="settings-glyph about-glyph" aria-hidden="true" /><div><h2 id="about-title">About</h2><p className="settings-about-description">Coffer is a multi-user, self-hosted authenticator vault for encrypted TOTP accounts, QR imports, local service logos, groups, and portable backups.</p></div></div>
              <p className="settings-about-stack"><strong>Stack:</strong> React 19 + Vinext + Vite 8 + TypeScript 5 + Tailwind CSS 4, Web Crypto (AES-256-GCM and HMAC-SHA-256) + Argon2id, Node.js 22, and Docker.</p>
              <p className="settings-about-author">
                <strong>Author:</strong>
                <a className="settings-about-link" href="https://github.com/caglaryalcin/Coffer" target="_blank" rel="noopener noreferrer" aria-label="Coffer repository by caglaryalcin on GitHub (opens in a new tab)">
                  <span className="settings-about-github-icon" aria-hidden="true" />
                  <span>caglaryalcin</span>
                </a>
              </p>
            </div>
          </section>

          <section className="settings-card session-card" id="session-settings" aria-labelledby="session-settings-title" tabIndex={-1}>
            <div className="settings-card-copy"><span className="settings-glyph session-glyph" /><div><h2 id="session-settings-title">Vault session</h2><p>Encrypted vault data is persisted on your self-hosted server and remains available after refresh.</p></div></div>
            <button className="signout-button" onClick={onSignOut} disabled={passwordBusy}>Lock and sign out</button>
          </section>

          <section className="settings-card account-delete-card" id="delete-account-settings" aria-labelledby="delete-account-settings-title" tabIndex={-1}>
            <div className="settings-card-copy"><span className="settings-glyph account-delete-glyph" aria-hidden="true" /><div><h2 id="delete-account-settings-title">Delete account</h2><p>Permanently remove this user and its encrypted vault from Coffer server storage.</p></div></div>
            {!deleteExpanded ? (
              <button
                ref={deleteToggleRef}
                className="account-delete-toggle"
                type="button"
                aria-expanded="false"
                aria-controls="account-delete-confirmation"
                disabled={passwordBusy}
                onClick={() => {
                  restoreDeleteToggleFocusRef.current = false;
                  setDeleteExpanded(true);
                }}
              >Delete this account</button>
            ) : (
              <form id="account-delete-confirmation" className="account-delete-form" onSubmit={(event) => void deleteAccount(event)} aria-busy={deleteBusy}>
                <div className="account-delete-warning" role="note">
                  <strong>This action cannot be undone.</strong>
                  <span>Exported backup files, Kubernetes volume snapshots, and host backups are not removed.</span>
                </div>
                <div className="account-delete-fields">
                  <label><span>Current password</span><input ref={deletePasswordRef} type="password" value={deletePassword} onChange={(event) => { setDeletePassword(event.target.value); setDeleteError(""); }} autoComplete="current-password" disabled={deleteBusy || passwordBusy} /></label>
                  <label><span>Enter {profile.email} to confirm</span><input type="email" value={deleteConfirmation} onChange={(event) => { setDeleteConfirmation(event.target.value); setDeleteError(""); }} autoComplete="off" spellCheck={false} disabled={deleteBusy || passwordBusy} /></label>
                </div>
                {deleteError && <p className="settings-error" role="alert">{deleteError}</p>}
                <div className="account-delete-actions">
                  <button type="button" onClick={cancelAccountDeletion} disabled={deleteBusy || passwordBusy}>Cancel</button>
                  <button type="submit" disabled={deleteBusy || passwordBusy}>{deleteBusy ? "Deleting account…" : "Delete account permanently"}</button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
