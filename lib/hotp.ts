import { MAX_HOTP_COUNTER, validateHotpCounter } from "./totp";
import type { VaultAccount } from "./vault-model";

/** Advance only the exact counter the user saw; never consume a newer token. */
export function advanceHotpAccount(account: VaultAccount, expectedCounter: number): VaultAccount {
  if (account.otpType !== "hotp") throw new Error("Only HOTP accounts have a counter.");
  const counter = validateHotpCounter(account.counter);
  if (counter !== expectedCounter) throw new Error("The HOTP counter changed. Use the current code before advancing again.");
  if (counter === MAX_HOTP_COUNTER) throw new Error("The HOTP counter cannot be advanced further.");
  return { ...account, counter: counter + 1 };
}
