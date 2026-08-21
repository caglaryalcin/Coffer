"use client";

import { FormEvent, useState } from "react";
import type { VaultProfile, VaultSettings } from "../../lib/vault-model";

const DISPLAY_NAME_MIN_LENGTH = 2;
const DISPLAY_NAME_MAX_LENGTH = 80;

export type DemoSettingsCenterProps = {
  profile: VaultProfile;
  settings: VaultSettings;
  onProfileNameChange: (name: string) => boolean | void;
  onSettingsChange: (patch: Partial<VaultSettings>) => void;
};

function validateDisplayName(value: string): string | null {
  const length = value.trim().length;
  if (length < DISPLAY_NAME_MIN_LENGTH) {
    return `Enter a display name with at least ${DISPLAY_NAME_MIN_LENGTH} characters.`;
  }
  if (length > DISPLAY_NAME_MAX_LENGTH) {
    return `Use a display name with ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`;
  }
  return null;
}

export default function DemoSettingsCenter({
  profile,
  settings,
  onProfileNameChange,
  onSettingsChange,
}: DemoSettingsCenterProps) {
  const [name, setName] = useState(profile.name);
  const [profileNameSource, setProfileNameSource] = useState(profile.name);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  if (profile.name !== profileNameSource) {
    setProfileNameSource(profile.name);
    setName(profile.name);
    setError("");
    setStatus("");
  }

  const saveProfile = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setStatus("");

    const nameError = validateDisplayName(name);
    if (nameError) {
      setError(nameError);
      return;
    }

    const normalizedName = name.trim();
    try {
      const applied = onProfileNameChange(normalizedName);
      if (applied === false) {
        setError("The demo display name could not be updated.");
        return;
      }
      setName(normalizedName);
      setStatus("Demo profile updated. This change resets on refresh.");
    } catch {
      setError("The demo display name could not be updated. Please try again.");
    }
  };

  return (
    <section className="settings-center" id="demo-settings-root" aria-labelledby="demo-settings-title" tabIndex={-1}>
      <h1 className="visually-hidden" id="demo-settings-title">Demo settings</h1>
      <div className="settings-layout">
        <div className="settings-stack">
          <section className="settings-card" id="demo-profile-settings" aria-labelledby="demo-profile-title" tabIndex={-1}>
            <div className="settings-card-copy">
              <span className="settings-glyph profile-glyph" aria-hidden="true" />
              <div><h2 id="demo-profile-title">Profile</h2><p>Preview the profile shown in this demo.</p></div>
            </div>
            <form className="settings-form" onSubmit={saveProfile}>
              <div className="profile-field-grid">
                <label className="profile-field" htmlFor="demo-display-name">
                  <span>Display name</span>
                  <input
                    id="demo-display-name"
                    value={name}
                    minLength={DISPLAY_NAME_MIN_LENGTH}
                    maxLength={DISPLAY_NAME_MAX_LENGTH}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "demo-display-name-error" : undefined}
                    autoComplete="name"
                    onChange={(event) => {
                      setName(event.target.value);
                      setError("");
                      setStatus("");
                    }}
                  />
                </label>
                <label className="profile-field" htmlFor="demo-sign-in-email">
                  <span>Sign-in email</span>
                  <input
                    id="demo-sign-in-email"
                    type="email"
                    value={profile.email}
                    readOnly
                    aria-readonly="true"
                    autoComplete="username"
                  />
                  <small>This sample email is read-only and does not identify a real account.</small>
                </label>
              </div>
              {error && <p className="settings-error" id="demo-display-name-error" role="alert">{error}</p>}
              {status && <p role="status">{status}</p>}
              <div className="settings-actions"><button type="submit">Save changes</button></div>
            </form>
          </section>

          <section className="settings-card" id="demo-security-settings" aria-labelledby="demo-security-title" tabIndex={-1}>
            <div className="settings-card-copy">
              <span className="settings-glyph security-glyph" aria-hidden="true"><span className="security-glyph-lock" /></span>
              <div>
                <h2 id="demo-security-title">Security</h2>
                <p>Preview these controls in the demo. Demo settings reset on refresh.</p>
              </div>
            </div>
            <div className="settings-control-row">
              <div>
                <strong>Automatic lock</strong>
                <span>Choose a sample inactivity delay for this temporary preview.</span>
              </div>
              <select
                id="demo-auto-lock-delay"
                aria-label="Demo automatic lock delay"
                value={settings.autoLockMinutes}
                onChange={(event) => onSettingsChange({ autoLockMinutes: Number(event.target.value) })}
              >
                <option value="1">After 1 minute</option>
                <option value="5">After 5 minutes</option>
                <option value="15">After 15 minutes</option>
                <option value="30">After 30 minutes</option>
                <option value="0">Never</option>
              </select>
            </div>
            <div className="settings-toggle-row">
              <span>
                <label htmlFor="demo-lock-when-hidden">Lock immediately when Coffer is hidden</label>
                <small>This preview preference resets when the demo is refreshed.</small>
              </span>
              <input
                id="demo-lock-when-hidden"
                type="checkbox"
                checked={settings.lockWhenHidden}
                onChange={(event) => onSettingsChange({ lockWhenHidden: event.target.checked })}
              />
            </div>
            <div className="settings-toggle-row">
              <span>
                <label htmlFor="demo-clear-copied-codes">Clear copied codes</label>
                <small>Preview best-effort clipboard removal after 30 seconds. This demo setting resets on refresh.</small>
              </span>
              <input
                id="demo-clear-copied-codes"
                type="checkbox"
                checked={settings.clearClipboard}
                onChange={(event) => onSettingsChange({ clearClipboard: event.target.checked })}
              />
            </div>
          </section>

          <section className="settings-about" id="demo-about-settings" aria-labelledby="demo-about-title" tabIndex={-1}>
            <div className="settings-about-panel">
              <div className="settings-card-copy">
                <span className="settings-glyph about-glyph" aria-hidden="true" />
                <div>
                  <h2 id="demo-about-title">About</h2>
                  <p className="settings-about-description">Coffer is a multi-user, self-hosted authenticator vault for encrypted TOTP accounts, QR imports, local service logos, groups, and portable backups.</p>
                </div>
              </div>
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

          <section className="settings-card session-card" id="demo-session-settings" aria-labelledby="demo-session-title" tabIndex={-1}>
            <div className="settings-card-copy">
              <span className="settings-glyph session-glyph" aria-hidden="true" />
              <div>
                <h2 id="demo-session-title">Demo session</h2>
                <p>This demo uses memory-only sample data. Nothing is saved, and refreshing the page restores the original sample data and settings.</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
