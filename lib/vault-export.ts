import { unlockVaultHeader, VaultCryptoError, type EncryptedVaultHeader } from "./vault-crypto";

/** Authorizes one export and lets the caller recheck the session before download. */
export async function authorizeVaultExport(
  password: string,
  header: EncryptedVaultHeader,
  sessionIsCurrent: () => boolean,
): Promise<() => void> {
  const assertAuthorized = () => {
    if (!sessionIsCurrent()) {
      throw new Error("The vault session changed. Unlock it again before exporting.");
    }
  };
  assertAuthorized();
  if (!password) throw new Error("Enter your current account password.");
  try {
    await unlockVaultHeader(password, header);
  } catch (error) {
    if (error instanceof VaultCryptoError && error.code === "AUTHENTICATION_FAILED") {
      throw new Error("The current password is incorrect.");
    }
    throw new Error("The current password could not be verified.");
  }
  assertAuthorized();
  return assertAuthorized;
}
