import type { VaultProfile, VaultSettings } from "../../lib/vault-model";

export type DemoSettingsCenterProps = {
  profile: VaultProfile;
  settings: VaultSettings;
};

export default function DemoSettingsCenter({
  profile,
  settings,
}: DemoSettingsCenterProps) {
  return (
    <section className="settings-center" id="demo-settings-root" aria-labelledby="demo-settings-title" tabIndex={-1}>
      <h1 className="visually-hidden" id="demo-settings-title">Demo settings</h1>
      <p className="demo-settings-read-only-banner" id="demo-settings-read-only-note" role="note">
        Settings are read-only in the public demo. Safe account, group, selection, and drag-and-drop previews remain interactive and reset automatically every hour.
      </p>
      <div className="settings-layout">
        <div className="settings-stack">
          <section className="settings-card" id="demo-profile-settings" aria-labelledby="demo-profile-title" tabIndex={-1}>
            <div className="settings-card-copy">
              <span className="settings-glyph profile-glyph" aria-hidden="true" />
              <div><h2 id="demo-profile-title">Profile</h2><p>Preview how your encrypted profile appears throughout Coffer.</p></div>
            </div>
            <div className="settings-form" aria-describedby="demo-settings-read-only-note">
              <div className="profile-photo-control">
                <span className="profile-photo-preview" aria-hidden="true">
                  <span>{profile.name.trim().charAt(0).toUpperCase() || "C"}</span>
                </span>
                <div className="profile-photo-copy">
                  <strong>Profile photo</strong>
                  <small>In the full app, PNG, JPEG, or WebP photos are cropped to a square and stored inside your encrypted vault.</small>
                  <div className="profile-photo-actions">
                    <button
                      className="demo-disabled-control"
                      type="button"
                      disabled
                      aria-disabled="true"
                      aria-describedby="demo-profile-photo-disabled"
                    >Choose photo</button>
                  </div>
                  <small id="demo-profile-photo-disabled">Disabled in the public demo. No file picker is connected.</small>
                </div>
              </div>
              <div className="profile-field-grid">
                <label className="profile-field" htmlFor="demo-display-name">
                  <span>Display name</span>
                  <input
                    id="demo-display-name"
                    value={profile.name}
                    readOnly
                    aria-readonly="true"
                    autoComplete="name"
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
              <div className="settings-actions">
                <button className="demo-disabled-control" type="button" disabled aria-disabled="true">Save changes</button>
              </div>
            </div>
          </section>

          <section className="settings-card" id="demo-security-settings" aria-labelledby="demo-security-title" tabIndex={-1}>
            <div className="settings-card-copy">
              <span className="settings-glyph security-glyph" aria-hidden="true"><span className="security-glyph-lock" /></span>
              <div>
                <h2 id="demo-security-title">Security</h2>
                <p>Preview the full app&apos;s security controls. These settings cannot be changed in the public demo.</p>
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
                disabled
                aria-disabled="true"
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
                <small>Shown for feature discovery; locked to the sample configuration.</small>
              </span>
              <input
                id="demo-lock-when-hidden"
                type="checkbox"
                checked={settings.lockWhenHidden}
                disabled
                aria-disabled="true"
              />
            </div>
            <div className="settings-toggle-row">
              <span>
                <label htmlFor="demo-clear-copied-codes">Clear copied codes</label>
                <small>Best-effort clipboard removal after 30 seconds is fixed for this demo.</small>
              </span>
              <input
                id="demo-clear-copied-codes"
                type="checkbox"
                checked={settings.clearClipboard}
                disabled
                aria-disabled="true"
              />
            </div>
            <div className="settings-inline-actions">
              <button
                className="demo-disabled-control"
                type="button"
                disabled
                aria-disabled="true"
                aria-describedby="demo-lock-vault-disabled"
              >Lock vault now</button>
            </div>
            <p className="demo-feature-disabled-note" id="demo-lock-vault-disabled">Vault locking requires a real encrypted session and is disabled in the public demo.</p>
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
                <p>This previews the full app&apos;s vault session controls. Demo data stays in memory and resets on refresh or automatically after one hour.</p>
                <small className="demo-feature-disabled-note" id="demo-sign-out-disabled">There is no authenticated user or encrypted server session to sign out from in this demo.</small>
              </div>
            </div>
            <button
              className="signout-button demo-disabled-control"
              type="button"
              disabled
              aria-disabled="true"
              aria-describedby="demo-sign-out-disabled"
            >Lock and sign out</button>
          </section>

          <section className="settings-card account-delete-card" id="demo-delete-account-settings" aria-labelledby="demo-delete-account-title" tabIndex={-1}>
            <div className="settings-card-copy">
              <span className="settings-glyph account-delete-glyph" aria-hidden="true" />
              <div>
                <h2 id="demo-delete-account-title">Delete account</h2>
                <p>Permanently remove this user and its encrypted vault from Coffer server storage.</p>
              </div>
            </div>
            <div className="account-delete-form" aria-disabled="true" aria-describedby="demo-delete-account-disabled">
              <div className="account-delete-warning" role="note">
                <strong>This action cannot be undone.</strong>
                <span>Exported backup files, Kubernetes volume snapshots, and host backups are not removed.</span>
              </div>
              <div className="account-delete-fields">
                <div className="demo-account-delete-field">
                  <span id="demo-current-password-label">Current password</span>
                  <div
                    className="demo-disabled-field"
                    role="textbox"
                    aria-readonly="true"
                    aria-disabled="true"
                    aria-labelledby="demo-current-password-label"
                  ><span aria-hidden="true">••••••••••••</span></div>
                </div>
                <div className="demo-account-delete-field">
                  <span id="demo-confirm-email-label">Enter {profile.email} to confirm</span>
                  <div
                    className="demo-disabled-field"
                    role="textbox"
                    aria-readonly="true"
                    aria-disabled="true"
                    aria-labelledby="demo-confirm-email-label"
                  >{profile.email}</div>
                </div>
              </div>
              <p className="demo-feature-disabled-note" id="demo-delete-account-disabled">Password entry and account deletion require a real encrypted account and are disabled in the public demo.</p>
              <div className="account-delete-actions">
                <button className="demo-disabled-control" type="button" disabled aria-disabled="true">Cancel</button>
                <button className="demo-disabled-control demo-delete-account-button" type="button" disabled aria-disabled="true">Delete account permanently</button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
