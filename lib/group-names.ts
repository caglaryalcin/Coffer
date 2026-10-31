export function normalizeGroupName(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

/** Shared identity for group matching, ordering, and branch operations. */
export function normalizedGroupKey(value: string) {
  return normalizeGroupName(value).normalize("NFKC").toLocaleLowerCase("en");
}

export const GROUP_PATH_SEPARATOR = " / ";

export function groupParentName(value: string) {
  const separatorIndex = value.lastIndexOf(GROUP_PATH_SEPARATOR);
  return separatorIndex < 0 ? null : value.slice(0, separatorIndex);
}

export function groupDisplayName(value: string) {
  const separatorIndex = value.lastIndexOf(GROUP_PATH_SEPARATOR);
  return separatorIndex < 0 ? value : value.slice(separatorIndex + GROUP_PATH_SEPARATOR.length);
}

export function groupDepth(value: string) {
  return value.split(GROUP_PATH_SEPARATOR).length - 1;
}

export function renameGroupBranchName(candidate: string, previousRoot: string, nextRoot: string) {
  if (normalizedGroupKey(candidate) === normalizedGroupKey(previousRoot)) return nextRoot;
  const suffix = candidate.split(GROUP_PATH_SEPARATOR).slice(groupDepth(previousRoot) + 1);
  return [nextRoot, ...suffix].join(GROUP_PATH_SEPARATOR);
}

export function hierarchicalGroupNames(groupNames: readonly string[]) {
  const available = new Set(groupNames.map(normalizedGroupKey));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const name of groupNames) {
    const parent = groupParentName(name);
    if (!parent || !available.has(normalizedGroupKey(parent))) {
      roots.push(name);
      continue;
    }
    const parentKey = normalizedGroupKey(parent);
    const siblings = children.get(parentKey) ?? [];
    siblings.push(name);
    children.set(parentKey, siblings);
  }
  const result: string[] = [];
  const append = (name: string) => {
    result.push(name);
    for (const child of children.get(normalizedGroupKey(name)) ?? []) append(child);
  };
  for (const root of roots) append(root);
  return result;
}

