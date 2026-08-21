const STABLE_VERSION_PATTERN = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

type StableVersion = readonly [major: number, minor: number, patch: number];

export function parseStableVersion(value: unknown): StableVersion | null {
  if (typeof value !== "string") return null;
  const match = STABLE_VERSION_PATTERN.exec(value);
  if (!match) return null;

  const version = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  return version.every(Number.isSafeInteger) ? version : null;
}

export function normalizeStableVersion(value: unknown): string | null {
  const version = parseStableVersion(value);
  return version ? version.join(".") : null;
}

export function compareStableVersions(left: unknown, right: unknown): -1 | 0 | 1 | null {
  const leftVersion = parseStableVersion(left);
  const rightVersion = parseStableVersion(right);
  if (!leftVersion || !rightVersion) return null;

  for (let index = 0; index < leftVersion.length; index += 1) {
    if (leftVersion[index] > rightVersion[index]) return 1;
    if (leftVersion[index] < rightVersion[index]) return -1;
  }
  return 0;
}

export const COFFER_VERSION_NUMBER = normalizeStableVersion(__COFFER_VERSION__) ?? __COFFER_VERSION__;
export const COFFER_VERSION = `v${COFFER_VERSION_NUMBER}`;
