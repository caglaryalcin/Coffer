import { GROUP_PATH_SEPARATOR, normalizedGroupKey } from "./group-names";
import { UNGROUPED_ACCOUNT_GROUP } from "./vault-model";

export function accountGroupIsInBranch(candidate: string, branchRoot: string) {
  const candidateKey = normalizedGroupKey(candidate);
  const rootKey = normalizedGroupKey(branchRoot);
  return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}${GROUP_PATH_SEPARATOR}`);
}

export function removeGroupBranchFromAccounts<T extends { group: string }>(
  accounts: readonly T[],
  branchRoot: string,
): T[] {
  return accounts.map((account) => accountGroupIsInBranch(account.group, branchRoot)
    ? { ...account, group: UNGROUPED_ACCOUNT_GROUP }
    : account);
}
