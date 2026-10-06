import type { VaultAccount } from "./vault-model";

export type SavedCustomLogo = { dataUrl: string; label: string };

/** Include archived cards, but show each stored image only once. */
export function savedCustomLogos(accounts: readonly VaultAccount[]): SavedCustomLogo[] {
  const logos = new Map<string, SavedCustomLogo>();
  for (const account of accounts) {
    if (account.iconDataUrl && !logos.has(account.iconDataUrl)) {
      logos.set(account.iconDataUrl, { dataUrl: account.iconDataUrl, label: account.service });
    }
  }
  return [...logos.values()];
}

export function withSelectedAccountLogo(
  accounts: readonly VaultAccount[],
  selectedIds: ReadonlySet<string>,
  patch: Pick<VaultAccount, "iconBrand" | "iconDataUrl">,
): VaultAccount[] {
  return accounts.map((account) => selectedIds.has(account.id) && !account.archived
    ? { ...account, iconBrand: patch.iconBrand, iconDataUrl: patch.iconDataUrl }
    : account);
}
