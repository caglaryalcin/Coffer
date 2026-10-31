import { normalizedGroupKey } from "./group-names";
import { UNGROUPED_ACCOUNT_GROUP, type VaultAccount } from "./vault-model";

export type VaultView = "all" | "favorites" | "archive" | "transfer" | "settings";

export function visibleVaultAccounts(
  accounts: readonly VaultAccount[],
  view: VaultView,
  group: string,
  query: string,
): VaultAccount[] {
  const normalizedQuery = query.trim().toLowerCase();
  const selectedGroupKey = group === UNGROUPED_ACCOUNT_GROUP ? null : normalizedGroupKey(group);
  const showArchived = view === "archive";

  return accounts.filter((account) => {
    if (account.archived !== showArchived) return false;
    if (view === "favorites" && !account.favorite) return false;
    if (selectedGroupKey !== null && normalizedGroupKey(account.group) !== selectedGroupKey) return false;
    if (!normalizedQuery) return true;

    const searchableText = [account.service, account.identity, account.group, ...account.urls].join(" ");
    return searchableText.toLowerCase().includes(normalizedQuery);
  });
}

export function countActiveAccountsByGroup(
  accounts: readonly Pick<VaultAccount, "group" | "archived">[],
  groups: readonly string[],
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const account of accounts) {
    if (account.archived) continue;
    const key = normalizedGroupKey(account.group);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(groups.map((name) => [name, counts.get(normalizedGroupKey(name)) ?? 0]));
}
