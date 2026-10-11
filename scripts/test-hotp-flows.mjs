import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `
      export { generateHotp, generateTotp, generateAccountCode, generateTotpTestPreview, validateOtpSettings, MAX_HOTP_COUNTER, createOtpAuthUri, parseOtpAuthUri } from './lib/totp';
      export { advanceHotpAccount } from './lib/hotp';
      export { createEmptyVault, withVaultUpdate, parsePersistedVault } from './lib/vault-model';
      export { projectCofferAccount, createPlainBackup, parsePlainBackup, createEncryptedBackup, decryptBackup } from './lib/backup';
      export { parseTwoFAuthExport, parseOtpAuthList } from './lib/importers';
      export { createTwoFasBackup, parseTwoFasBackup } from './lib/twofas';
      export { validateAccountEditorValues, accountSecretTestReadiness } from './lib/account-editor';
    `,
    resolveDir: process.cwd(),
  },
  bundle: true, platform: "node", format: "esm", write: false,
});
const otp = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
// RFC 4226 Appendix D: https://www.rfc-editor.org/rfc/rfc4226#appendix-D
const vectors = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
for (let counter = 0; counter < vectors.length; counter += 1) {
  assert.equal(await otp.generateHotp(secret, counter), vectors[counter]);
}
assert.equal(await otp.generateTotp(secret, 59_000, 8), "94287082");
const account = {
  id: "hotp-test", service: "Counter service", identity: "test@example.com", urls: [],
  secret, group: "Personal", color: "ink", letter: "CS", favorite: false,
  archived: false, lastUsed: 0, algorithm: "SHA-1", digits: 6, period: 30,
  iconBrand: null, iconDataUrl: null, otpType: "hotp", counter: 0,
};
assert.equal(await otp.generateAccountCode(account, 0), vectors[0]);
assert.equal(await otp.generateAccountCode(account, 999_999_999), vectors[0]);
assert.equal(account.counter, 0, "Reading/copying a code must never advance HOTP");
assert.deepEqual(otp.advanceHotpAccount(account, 0), { ...account, counter: 1 });
assert.throws(() => otp.advanceHotpAccount({ ...account, counter: 1 }, 0));
assert.throws(() => otp.advanceHotpAccount({ ...account, counter: otp.MAX_HOTP_COUNTER }, otp.MAX_HOTP_COUNTER));
assert.throws(() => otp.advanceHotpAccount({ ...account, otpType: "totp" }, 0));
for (const counter of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null, undefined]) {
  assert.throws(() => otp.validateOtpSettings({ ...account, counter }));
}
for (const counter of [0, 2 ** 32 - 1, 2 ** 32, otp.MAX_HOTP_COUNTER]) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", "12345678901234567890").update(bytes).digest();
  const offset = digest[digest.length - 1] & 15;
  const expected = String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
  assert.equal(await otp.generateHotp(secret, counter), expected);
}
assert.equal((await otp.generateTotpTestPreview(account)).expiresAt, Infinity);
assert.throws(() => otp.validateOtpSettings({ ...account, otpType: "steam" }));
console.log("PASS: HOTP RFC vectors, counter boundaries, time independence, and explicit advancement");

const vault = otp.withVaultUpdate(otp.createEmptyVault({ name: "Test", email: "test@example.com" }), { accounts: [account] });
assert.deepEqual(otp.parsePersistedVault(JSON.parse(JSON.stringify(vault))).accounts[0], account);
const legacyAccount = { ...account };
delete legacyAccount.otpType;
delete legacyAccount.counter;
const migrated = otp.parsePersistedVault({ ...vault, version: 11, accounts: [legacyAccount] });
assert.equal(migrated.accounts[0].otpType, "totp");
assert.equal(migrated.accounts[0].counter, 0);
assert.throws(() => otp.parsePersistedVault({ ...vault, accounts: [{ ...account, counter: -1 }] }));
assert.throws(() => otp.parsePersistedVault({ ...vault, accounts: [{ ...account, otpType: "steam" }] }));
const portable = otp.projectCofferAccount({ ...account, counter: 2 ** 32 });
assert.deepEqual(otp.parsePlainBackup(otp.createPlainBackup([portable])), [portable]);
assert.deepEqual(await otp.decryptBackup(await otp.createEncryptedBackup([portable], "test-password"), "test-password"), [portable]);
const legacyPortable = { ...portable };
delete legacyPortable.otpType;
delete legacyPortable.counter;
assert.equal(otp.parsePlainBackup(JSON.stringify({ format: "coffer-backup", version: 4, kind: "accounts", accounts: [legacyPortable] }))[0].secret, secret);
console.log("PASS: HOTP vault/backup persistence and legacy TOTP migration");

const uriFields = { issuer: "İş & counter", account: "hotp@example.com", secret, algorithm: "SHA-1", digits: 8, period: 30, otpType: "hotp", counter: 2 ** 32 };
const uri = otp.createOtpAuthUri(uriFields);
assert.ok(uri.startsWith("otpauth://hotp/"));
assert.deepEqual(otp.parseOtpAuthUri(uri), uriFields);
assert.equal(otp.parseOtpAuthList(uri).items[0].account.counter, 2 ** 32);
for (const counter of ["", "-1", "1.5", "9007199254740992"]) {
  assert.throws(() => otp.parseOtpAuthUri(`otpauth://hotp/Test:a?secret=${secret}&counter=${counter}`));
}
assert.throws(() => otp.parseOtpAuthUri(`otpauth://hotp/Test:a?secret=${secret}`));
assert.throws(() => otp.parseOtpAuthUri(`otpauth://totp/Steam:a?secret=${secret}&encoder=steam`));
const twofauth = otp.parseTwoFAuthExport(JSON.stringify({
  app: "2fauth_test", schema: 1, data: [{ otp_type: "hotp", service: "Counter", account: "a", secret, algorithm: "sha1", digits: 6, period: null, counter: 7 }],
}));
assert.equal(twofauth.items[0].account.otpType, "hotp");
assert.equal(twofauth.items[0].account.counter, 7);
const imported = (await otp.parseTwoFasBackup(await otp.createTwoFasBackup([portable], "test-password"), "test-password")).items[0];
assert.equal(imported.issue, undefined);
assert.equal(imported.account.otpType, "hotp");
assert.equal(imported.account.counter, 2 ** 32);
assert.equal(otp.validateAccountEditorValues({ ...account, counter: 7 }).counter, 7);
assert.equal(otp.accountSecretTestReadiness(secret, { ...account, counter: 1 }, account).status, "ready");
console.log("PASS: HOTP OTPAuth, 2FAuth, 2FAS, and editor configuration");
