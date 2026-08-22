import {
  COFFER_INITIALS_BRAND_ID,
  serviceBrandById,
  serviceBrandOptions,
  selfhstServiceBrandOptions,
  type ServiceBrandOption,
} from "../ServiceLogo";

function logoSearchKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function logoOptionScore(option: ServiceBrandOption, query: string) {
  const normalizedQuery = logoSearchKey(query);
  if (!normalizedQuery) return Number.POSITIVE_INFINITY;

  const keys = [
    option.title,
    option.id,
    option.familyId,
    option.variantLabel,
    ...option.searchTerms,
  ].map(logoSearchKey).filter(Boolean);
  if (keys.some((key) => key === normalizedQuery)) return 0;
  if (keys.some((key) => key.startsWith(normalizedQuery))) return 1;
  if (keys.some((key) => key.includes(normalizedQuery))) return 2;

  const searchable = keys.join(" ");
  const tokens = normalizedQuery.split(/\s+/u).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => searchable.includes(token))
    ? 3
    : Number.POSITIVE_INFINITY;
}

export function demoServiceBrandOptions(query: string, selectedId = "", requestedLimit = 12) {
  const limit = Math.max(1, Math.min(40, Math.floor(requestedLimit) || 12));
  const integratedOptions = serviceBrandOptions(query, limit);
  const extendedOptions = selfhstServiceBrandOptions()
    .flatMap((option) => {
      const score = logoOptionScore(option, query);
      return Number.isFinite(score) ? [{ option, score }] : [];
    })
    .sort((left, right) => (
      left.score - right.score
      || left.option.variantOrder - right.option.variantOrder
      || left.option.title.localeCompare(right.option.title, "en")
    ))
    .slice(0, limit)
    .map(({ option }) => option);
  const selected = selectedId && selectedId !== COFFER_INITIALS_BRAND_ID
    ? serviceBrandById(selectedId)
    : null;
  const split = Math.max(1, Math.floor(limit / 2));
  const candidates = [
    ...(selected ? [selected] : []),
    ...integratedOptions.slice(0, split),
    ...extendedOptions.slice(0, split),
    ...integratedOptions,
    ...extendedOptions,
  ];
  const unique = new Map<string, ServiceBrandOption>();
  for (const option of candidates) {
    if (!unique.has(option.id)) unique.set(option.id, option);
    if (unique.size >= limit) break;
  }
  return [...unique.values()];
}
