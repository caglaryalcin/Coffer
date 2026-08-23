export type AccountDropEdge = "before" | "after";

export function reorderVisibleAccounts<T extends { id: string }>(
  accounts: T[],
  visibleAccountIds: readonly string[],
  movedAccountIds: ReadonlySet<string>,
  targetAccountId: string,
  edge: AccountDropEdge,
): T[] {
  const visibleIds = new Set(visibleAccountIds);
  if (!visibleIds.has(targetAccountId) || movedAccountIds.has(targetAccountId)) return accounts;

  const movingIds = visibleAccountIds.filter((id) => movedAccountIds.has(id));
  if (movingIds.length === 0) return accounts;

  const stationaryIds = visibleAccountIds.filter((id) => !movedAccountIds.has(id));
  const targetIndex = stationaryIds.indexOf(targetAccountId);
  if (targetIndex < 0) return accounts;

  const reorderedVisibleIds = [...stationaryIds];
  reorderedVisibleIds.splice(targetIndex + (edge === "after" ? 1 : 0), 0, ...movingIds);
  if (reorderedVisibleIds.every((id, index) => id === visibleAccountIds[index])) return accounts;

  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  let reorderedIndex = 0;
  return accounts.map((account) => {
    if (!visibleIds.has(account.id)) return account;
    const reorderedId = reorderedVisibleIds[reorderedIndex];
    reorderedIndex += 1;
    return accountsById.get(reorderedId) ?? account;
  });
}
