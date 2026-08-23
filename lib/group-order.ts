import type { VaultAccount, VaultGroupCustomization } from "./vault-model";

export type GroupDropEdge = "before" | "after";

function normalizedGroupKey(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en");
}

export function orderedVisibleGroupNames(
  accounts: readonly Pick<VaultAccount, "group" | "archived">[],
  customizations: readonly Pick<VaultGroupCustomization, "name">[],
  groupOrder: readonly string[],
) {
  const availableNames = new Map<string, string>();

  for (const account of accounts) {
    if (!account.archived) {
      availableNames.set(normalizedGroupKey(account.group), account.group);
    }
  }
  for (const customization of customizations) {
    availableNames.set(normalizedGroupKey(customization.name), customization.name);
  }

  const names: string[] = [];
  const seen = new Set<string>();
  const addIfVisible = (rawName: string) => {
    const key = normalizedGroupKey(rawName);
    const name = availableNames.get(key);
    if (!name || seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };

  for (const name of groupOrder) addIfVisible(name);
  for (const account of accounts) {
    if (!account.archived) addIfVisible(account.group);
  }
  for (const customization of customizations) addIfVisible(customization.name);

  return names;
}

export function moveGroupName(
  groups: readonly string[],
  sourceName: string,
  targetName: string,
  edge: GroupDropEdge,
) {
  const sourceKey = normalizedGroupKey(sourceName);
  const targetKey = normalizedGroupKey(targetName);
  if (!sourceKey || sourceKey === targetKey) return [...groups];

  const source = groups.find((name) => normalizedGroupKey(name) === sourceKey);
  if (!source) return [...groups];

  const withoutSource = groups.filter((name) => normalizedGroupKey(name) !== sourceKey);
  const targetIndex = withoutSource.findIndex((name) => normalizedGroupKey(name) === targetKey);
  if (targetIndex < 0) return [...groups];

  withoutSource.splice(targetIndex + (edge === "after" ? 1 : 0), 0, source);
  return withoutSource;
}

export function mergeVisibleGroupOrder(
  groupOrder: readonly string[],
  visibleGroups: readonly string[],
) {
  const visibleKeys = new Set(visibleGroups.map(normalizedGroupKey));
  const nextOrder: string[] = [];
  const seen = new Set<string>();
  let visibleIndex = 0;

  const appendUnique = (name: string) => {
    const key = normalizedGroupKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    nextOrder.push(name);
  };

  for (const name of groupOrder) {
    if (visibleKeys.has(normalizedGroupKey(name))) {
      const replacement = visibleGroups[visibleIndex];
      visibleIndex += 1;
      if (replacement) appendUnique(replacement);
    } else {
      appendUnique(name);
    }
  }
  for (; visibleIndex < visibleGroups.length; visibleIndex += 1) {
    appendUnique(visibleGroups[visibleIndex]);
  }

  return nextOrder;
}

export function renameGroupInOrder(
  groupOrder: readonly string[],
  previousName: string,
  nextName: string,
) {
  const previousKey = normalizedGroupKey(previousName);
  const nextKey = normalizedGroupKey(nextName);
  const nextOrder: string[] = [];
  let inserted = false;

  for (const name of groupOrder) {
    const key = normalizedGroupKey(name);
    if (key === previousKey || key === nextKey) {
      if (!inserted) {
        nextOrder.push(nextName);
        inserted = true;
      }
    } else {
      nextOrder.push(name);
    }
  }

  if (!inserted) nextOrder.push(nextName);
  return nextOrder;
}

export function removeGroupFromOrder(groupOrder: readonly string[], groupName: string) {
  const removedKey = normalizedGroupKey(groupName);
  return groupOrder.filter((name) => normalizedGroupKey(name) !== removedKey);
}

export function appendGroupToOrder(groupOrder: readonly string[], groupName: string) {
  const addedKey = normalizedGroupKey(groupName);
  return groupOrder.some((name) => normalizedGroupKey(name) === addedKey)
    ? [...groupOrder]
    : [...groupOrder, groupName];
}
