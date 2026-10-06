import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import jsQR from "jsqr";

// Bundle the actual TS helpers in memory so tests need no additional runtime.
const result = await build({
  stdin: {
    contents: `
      export { createAccountQr } from './lib/account-qr';
      export { createOtpAuthUri, parseOtpAuthUri } from './lib/totp';
      export { savedCustomLogos, withSelectedAccountLogo } from './lib/custom-logos';
      export { accountCreationDestination } from './lib/account-navigation';
      export { createEmptyVault, parsePersistedVault, withVaultUpdate } from './lib/vault-model';
    `,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const {
  createAccountQr, createOtpAuthUri, parseOtpAuthUri, savedCustomLogos, withSelectedAccountLogo,
  accountCreationDestination, createEmptyVault, parsePersistedVault, withVaultUpdate,
} = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

for (const group of ["Personal", "Work / AI", "All"]) {
  assert.deepEqual(accountCreationDestination("all", group), { view: "all", group });
}
assert.deepEqual(accountCreationDestination("favorites", "Personal"), { view: "favorites", group: "All" });
assert.deepEqual(accountCreationDestination("archive", "Personal"), { view: "all", group: "All" });
console.log("PASS: account creation preserves the origin group and Favorites behavior");

const logos = savedCustomLogos([
  { service: "Active", iconDataUrl: "logo-a", archived: false },
  { service: "Duplicate", iconDataUrl: "logo-a", archived: false },
  { service: "Archived", iconDataUrl: "logo-b", archived: true },
  { service: "Automatic", iconDataUrl: null, archived: false },
]);
assert.deepEqual(logos, [
  { dataUrl: "logo-a", label: "Active" },
  { dataUrl: "logo-b", label: "Archived" },
]);
assert.deepEqual(savedCustomLogos([]), []);
console.log("PASS: saved custom logos are deduplicated and include archived cards");

const empty = createEmptyVault({ name: "Test", email: "test@example.com" });
const favorites = withVaultUpdate(empty, { settings: { ...empty.settings, mainScreen: { kind: "favorites" } } });
const restored = parsePersistedVault(JSON.parse(JSON.stringify(favorites)));
assert.deepEqual(restored.settings.mainScreen, { kind: "favorites" });
assert.deepEqual(withVaultUpdate(restored, { accounts: [] }).settings.mainScreen, { kind: "favorites" });
assert.deepEqual(empty.settings.mainScreen, { kind: "all" });
assert.throws(() => parsePersistedVault({ ...favorites, settings: { ...favorites.settings, mainScreen: { kind: "favorites", group: "Invalid" } } }));
console.log("PASS: Favorites default survives saving, reopening, and an empty vault");

function decodeQr(qr) {
  const scale = 6;
  const width = qr.size * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  for (const match of qr.path.matchAll(/M(\d+),(\d+)h1v1h-1z/gu)) {
    const x = Number(match[1]) * scale;
    const y = Number(match[2]) * scale;
    for (let dy = 0; dy < scale; dy += 1) {
      for (let dx = 0; dx < scale; dx += 1) {
        const offset = ((y + dy) * width + x + dx) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
      }
    }
  }
  const decoded = jsQR(pixels, width, width);
  assert.ok(decoded, "Generated QR must be readable by the existing QR scanner");
  return decoded.data;
}

for (const algorithm of ["SHA-1", "SHA-256", "SHA-512"]) {
  for (const digits of [6, 8]) {
    const account = {
      issuer: "İş hesabı & AI / 日本語", account: "test+qr@example.com",
      secret: "JBSWY3DPEHPK3PXP", algorithm, digits, period: 60,
    };
    const encoded = decodeQr(createAccountQr(account));
    assert.equal(encoded, createOtpAuthUri(account));
    assert.deepEqual(parseOtpAuthUri(encoded), account);
  }
}
assert.throws(() => createAccountQr({ issuer: "Test", account: "a", secret: "INVALID!", algorithm: "SHA-1", digits: 6, period: 30 }));
assert.throws(() => createAccountQr({ issuer: "Test", account: "a", secret: "JBSWY3DPEHPK3PXP", algorithm: "SHA-1", digits: 6, period: 0 }));
console.log("PASS: QR round-trip preserves secret, Unicode labels, algorithms, digits, and period; invalid settings are rejected");

const editorBundle = await build({
  stdin: {
    contents: `
      import AccountEditor from './app/AccountEditor';
      import BulkLogoPicker from './app/BulkLogoPicker';
      export { validateBulkCustomLogoCapacity, accountIconDataUrlBytes, retainedAccountIconBytes } from './app/BulkLogoPicker';
      import SettingsCenter from './app/SettingsCenter';
      import { I18nProvider } from './app/I18nProvider';
      import { createElement } from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      export function renderEditor(props) {
        return renderToStaticMarkup(createElement(AccountEditor, props));
      }
      export function renderBulkLogoPicker(props) {
        return renderToStaticMarkup(createElement(BulkLogoPicker, props));
      }
      export function renderSettings(props) {
        return renderToStaticMarkup(createElement(I18nProvider, null, createElement(SettingsCenter, props)));
      }
    `,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  write: false,
});
const editorModule = { exports: {} };
new Function("require", "module", "exports", editorBundle.outputFiles[0].text)(
  createRequire(import.meta.url), editorModule, editorModule.exports,
);
const markup = editorModule.exports.renderEditor({
  account: {
    id: "test-card", service: "Test", identity: "test@example.com", urls: ["https://example.com"],
    secret: "JBSWY3DPEHPK3PXP", group: "Personal", color: "ink", letter: "T",
    favorite: false, archived: false, lastUsed: 0, algorithm: "SHA-1", digits: 6, period: 30,
    iconBrand: null, iconDataUrl: null,
  },
  brandOptions: [], customLogos: [], onClose: () => {}, onSave: () => {},
  codePreview: { current: "123 456", next: "654 321", remaining: 20, period: 30 },
});
assert.deepEqual([...markup.matchAll(/<legend[^>]*>(.*?)<\/legend>/gu)].map((match) => match[1]), [
  "Platform logo", "Custom logo", "Account information", "Secret key", "TOTP settings",
]);
assert.match(markup, /type="password"/u);
assert.match(markup, /Live codes for Test/u);
assert.match(markup, /Website URLs/u);
assert.doesNotMatch(markup, /Account import QR code/u);
console.log("PASS: Account Details renders separate framed sections with all fields and keeps QR hidden initially");

const settingsMarkup = editorModule.exports.renderSettings({
  profile: { name: "Test", email: "test@example.com", avatarDataUrl: null },
  autoLockMinutes: 5, lockWhenHidden: false, clearClipboard: true, allowAccountCreation: true,
  onProfileChange: () => {}, onAutoLockMinutesChange: () => {}, onLockWhenHiddenChange: () => {},
  onClearClipboardChange: () => {}, onAllowAccountCreationChange: () => {}, onNotice: () => {},
  onSignOut: () => {}, onChangePassword: async () => {}, onDeleteAccount: async () => {},
});
assert.deepEqual([...settingsMarkup.matchAll(/<h2[^>]*>(.*?)<\/h2>/gu)].map((match) => match[1]), [
  "Profile", "Language", "OpenID Connect", "Security", "About", "Vault session", "Delete account",
]);
for (const id of ["profile-settings", "language-settings", "oidc-settings", "security-settings", "about-settings", "session-settings", "delete-account-settings"]) {
  assert.ok(settingsMarkup.includes(`id="${id}"`), `Settings navigation anchor ${id} must remain available`);
}
for (const label of ["Save profile", "Language", "Enable OIDC sign-in", "Automatic lock delay", "Lock and sign out", "Delete this account"]) {
  assert.ok(settingsMarkup.includes(label), `Existing settings control ${label} must remain available`);
}
assert.doesNotMatch(settingsMarkup, /<form[^>]*id="account-delete-confirmation"/u);
assert.match(settingsMarkup, /Loading OIDC settings/u);
assert.doesNotMatch(settingsMarkup, /<legend/u);
console.log("PASS: Settings retains its original card layout, controls, navigation, and closed deletion confirmation");

const customLogo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP9sAAAAASUVORK5CYII=";
const bulkMarkup = editorModule.exports.renderBulkLogoPicker({
  open: true, selectedCount: 2, brandOptions: [], retainedCustomLogoBytes: 0,
  customLogos: [{ dataUrl: customLogo, label: "Saved logo" }], onApply: () => true, onClose: () => {},
});
assert.deepEqual([...bulkMarkup.matchAll(/<legend[^>]*>(.*?)<\/legend>/gu)].map((match) => match[1]), ["Platform logo", "Custom logo"]);
assert.match(bulkMarkup, /type="file"/u);
assert.match(bulkMarkup, /Saved custom logos/u);
assert.match(bulkMarkup, /Saved logo/u);
assert.match(bulkMarkup, /Apply to 2/u);

const { validateBulkCustomLogoCapacity, accountIconDataUrlBytes, retainedAccountIconBytes } = editorModule.exports;
const largeLogo = `data:image/png;base64,${Buffer.alloc(96 * 1024).toString("base64")}`;
assert.equal(accountIconDataUrlBytes(largeLogo), 96 * 1024);
assert.doesNotThrow(() => validateBulkCustomLogoCapacity(largeLogo, 21, 0));
assert.throws(() => validateBulkCustomLogoCapacity(largeLogo, 22, 0), /2 MB/u);
assert.throws(() => validateBulkCustomLogoCapacity(largeLogo, 21, 48 * 1024), /2 MB/u);
assert.throws(() => validateBulkCustomLogoCapacity(customLogo, 0, 0));

const originalCards = [
  { id: "one", archived: false, service: "One", secret: "keep-secret-one", group: "Work", favorite: true, iconBrand: "old-brand", iconDataUrl: null },
  { id: "two", archived: false, service: "Two", secret: "keep-secret-two", group: "Personal", favorite: false, iconBrand: null, iconDataUrl: largeLogo },
  { id: "untouched", archived: false, iconBrand: null, iconDataUrl: customLogo },
  { id: "archived", archived: true, iconBrand: null, iconDataUrl: largeLogo },
];
const selectedIds = new Set(["one", "two", "archived"]);
const changedCards = withSelectedAccountLogo(originalCards, selectedIds, { iconBrand: null, iconDataUrl: customLogo });
for (let index = 0; index < 2; index += 1) {
  assert.deepEqual(changedCards[index], { ...originalCards[index], iconBrand: null, iconDataUrl: customLogo });
}
assert.equal(changedCards[2], originalCards[2]);
assert.equal(changedCards[3], originalCards[3]);
assert.equal(originalCards[0].iconDataUrl, null);
assert.equal(retainedAccountIconBytes(originalCards, new Set(["one", "two"])), accountIconDataUrlBytes(customLogo) + accountIconDataUrlBytes(largeLogo));
console.log("PASS: bulk custom logos support upload and saved choices, enforce total storage limits, and change only selected active cards");
