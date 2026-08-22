import type { CSSProperties } from "react";
import type { VaultColor } from "../lib/vault-model";
import {
  GENERATED_CURATED_SERVICE_BRAND_IDS,
  GENERATED_SERVICE_BRAND_SOURCE,
  generatedSelfhstServiceBrandFamilies,
  generatedServiceBrands,
  type GeneratedSelfhstServiceBrandFamily,
} from "./service-brands.generated";

declare const serviceBrandIdMarker: unique symbol;

/** An id that has been checked against Coffer's generated local brand catalog. */
export type ServiceBrandId = string & { readonly [serviceBrandIdMarker]: true };
/** Backward-compatible name for account-editor integrations. */
export type ServiceBrand = ServiceBrandId;

export type ServiceLogoProps = {
  color: VaultColor;
  fallback: string;
  service: string;
  /** A validated raster data URL stored inside the encrypted vault. */
  iconDataUrl?: string | null;
  /** Omit or pass null to resolve the logo automatically from `service`. */
  brandId?: ServiceBrandId | null;
};

export type ServiceBrandOption = {
  id: ServiceBrandId;
  title: string;
  color: `#${string}`;
  source: "simple-icons" | "font-awesome" | "curated" | "selfhst";
  familyId: string;
  variantLabel: string;
  searchTerms: readonly string[];
  variantOrder: number;
};

export type ResolvedServiceBrand = ServiceBrandOption & {
  asset: string;
};

type CatalogBrand = ResolvedServiceBrand & {
  automatic: boolean;
  matchKeys: readonly string[];
  pickerKeys: readonly string[];
};

type CuratedMatchRule = {
  id: string;
  aliases?: readonly string[];
  color?: `#${string}`;
  decorated?: boolean;
  domains?: readonly string[];
  title?: string;
};

const FONT_AWESOME_BRAND_IDS = new Set([
  "amazon",
  "aws",
  "linkedin",
  "microsoft",
  "openai",
  "slack",
  "twitter",
]);
const CURATED_BRAND_IDS = new Set<string>(GENERATED_CURATED_SERVICE_BRAND_IDS);
const SELFHST_ID_PREFIX = "selfhst-";
const SELFHST_REFERENCE = /^[a-z0-9][a-z0-9-]{0,49}$/u;
const SELFHST_STEM = /^[a-z0-9][a-z0-9-]{0,55}$/u;
const selfhstVariants = [
  { bit: 1, label: "Standard", order: 0, suffix: "" },
  { bit: 2, label: "Dark", order: 1, suffix: "-dark" },
  { bit: 4, label: "Light", order: 2, suffix: "-light" },
] as const;
let selfhstFamiliesByReference: ReadonlyMap<string, GeneratedSelfhstServiceBrandFamily> | null = null;
let cachedSelfhstBrandOptions: readonly ServiceBrandOption[] | null = null;

const curatedMatchRules: readonly CuratedMatchRule[] = [
  { id: "atomic", title: "Atomic Mail", aliases: ["atomic mail", "atomicmail"], decorated: true, domains: ["atomicmail.io"] },
  { id: "github", aliases: ["github"], color: "#181717", decorated: true, domains: ["github.com"] },
  { id: "google", aliases: ["google", "gmail", "google workspace"], color: "#4285f4", decorated: true, domains: ["google.com", "gmail.com", "googlemail.com"] },
  { id: "microsoft", aliases: ["microsoft", "microsoft 365", "office 365", "outlook"], color: "#5e5e5e", decorated: true, domains: ["microsoft.com", "microsoftonline.com", "live.com", "outlook.com", "office.com"] },
  { id: "azure", title: "Microsoft Azure", aliases: ["azure", "microsoft azure"], color: "#ffffff", decorated: true, domains: ["azure.com"] },
  { id: "heroku", aliases: ["heroku"], color: "#f4f3ee", decorated: true, domains: ["heroku.com"] },
  { id: "snapp", aliases: ["snapp", "snapp app", "snapp platform"], color: "#131b2e", decorated: true },
  { id: "aws", title: "Amazon Web Services", aliases: ["aws", "amazon web services"], color: "#232f3e", decorated: true, domains: ["aws.amazon.com", "amazonaws.com"] },
  { id: "amazon", title: "Amazon", aliases: ["amazon"], color: "#9a5b00", decorated: true, domains: ["amazon.com"] },
  { id: "apple", aliases: ["apple", "icloud"], color: "#000000", decorated: true, domains: ["apple.com", "icloud.com"] },
  { id: "discord", aliases: ["discord"], color: "#5865f2", decorated: true, domains: ["discord.com", "discordapp.com"] },
  { id: "facebook", aliases: ["facebook"], color: "#0866ff", decorated: true, domains: ["facebook.com", "fb.com"] },
  { id: "meta", aliases: ["meta"], color: "#0467df", decorated: true, domains: ["meta.com"] },
  { id: "instagram", aliases: ["instagram"], color: "#a52a6f", decorated: true, domains: ["instagram.com"] },
  { id: "x", aliases: ["x"], color: "#000000", domains: ["x.com"] },
  { id: "twitter", title: "Twitter", aliases: ["twitter"], color: "#1d79a8", decorated: true, domains: ["twitter.com"] },
  { id: "reddit", aliases: ["reddit"], color: "#c93600", decorated: true, domains: ["reddit.com"] },
  { id: "gitlab", aliases: ["gitlab"], color: "#b34715", decorated: true, domains: ["gitlab.com"] },
  { id: "bitbucket", aliases: ["bitbucket"], color: "#0052cc", decorated: true, domains: ["bitbucket.org"] },
  { id: "dropbox", aliases: ["dropbox"], color: "#0061ff", decorated: true, domains: ["dropbox.com"] },
  { id: "slack", aliases: ["slack"], color: "#4a154b", decorated: true, domains: ["slack.com"] },
  { id: "notion", aliases: ["notion"], color: "#000000", decorated: true, domains: ["notion.so", "notion.com"] },
  { id: "figma", aliases: ["figma"], color: "#a33b19", decorated: true, domains: ["figma.com"] },
  { id: "cloudflare", aliases: ["cloudflare"], color: "#a84900", decorated: true, domains: ["cloudflare.com"] },
  { id: "digitalocean", aliases: ["digitalocean", "digital ocean"], color: "#006bcf", decorated: true, domains: ["digitalocean.com"] },
  { id: "binance", aliases: ["binance"], color: "#806300", decorated: true, domains: ["binance.com"] },
  { id: "coinbase", aliases: ["coinbase"], color: "#0052cc", decorated: true, domains: ["coinbase.com"] },
  { id: "paypal", aliases: ["paypal"], color: "#002991", decorated: true, domains: ["paypal.com", "paypal.me"] },
  { id: "stripe", aliases: ["stripe"], color: "#635bff", decorated: true, domains: ["stripe.com"] },
  { id: "steam", aliases: ["steam"], color: "#000000", decorated: true, domains: ["steampowered.com", "steamcommunity.com"] },
  { id: "twitch", aliases: ["twitch"], color: "#7a2fd1", decorated: true, domains: ["twitch.tv"] },
  { id: "spotify", aliases: ["spotify"], color: "#126e35", decorated: true, domains: ["spotify.com"] },
  { id: "linkedin", title: "LinkedIn", aliases: ["linkedin", "linked in"], color: "#0a66c2", decorated: true, domains: ["linkedin.com"] },
  { id: "atlassian", aliases: ["atlassian"], color: "#0052cc", decorated: true, domains: ["atlassian.com"] },
  { id: "proton", aliases: ["proton", "protonmail", "proton mail"], color: "#6d4aff", decorated: true, domains: ["proton.me", "protonmail.com", "protonvpn.com"] },
  { id: "openai", title: "OpenAI", aliases: ["openai", "chatgpt"], color: "#111827", decorated: true, domains: ["openai.com", "chatgpt.com"] },

  { id: "1password", domains: ["1password.com"] },
  { id: "2fas", domains: ["2fas.com"] },
  { id: "airbnb", domains: ["airbnb.com"] },
  { id: "alibabadotcom", domains: ["alibaba.com"] },
  { id: "aliexpress", domains: ["aliexpress.com"] },
  { id: "anthropic", aliases: ["claude"], domains: ["anthropic.com", "claude.ai"] },
  { id: "auth0", domains: ["auth0.com"] },
  { id: "battledotnet", aliases: ["battle net"], domains: ["battle.net", "blizzard.com"] },
  { id: "bookingdotcom", aliases: ["booking.com"], domains: ["booking.com"] },
  { id: "ebay", domains: ["ebay.com"] },
  { id: "epicgames", domains: ["epicgames.com"] },
  { id: "etsy", domains: ["etsy.com"] },
  { id: "evernote", domains: ["evernote.com"] },
  { id: "huawei", domains: ["huawei.com"] },
  { id: "intel", domains: ["intel.com"] },
  { id: "kick", domains: ["kick.com"] },
  { id: "lastpass", domains: ["lastpass.com"] },
  { id: "mailchimp", domains: ["mailchimp.com"] },
  { id: "mastercard", domains: ["mastercard.com"] },
  { id: "medium", domains: ["medium.com"] },
  { id: "mongodb", domains: ["mongodb.com"] },
  { id: "netflix", domains: ["netflix.com"] },
  { id: "nvidia", domains: ["nvidia.com"] },
  { id: "patreon", domains: ["patreon.com"] },
  { id: "pinterest", domains: ["pinterest.com"] },
  { id: "playstation", domains: ["playstation.com"] },
  { id: "roblox", domains: ["roblox.com"] },
  { id: "samsung", domains: ["samsung.com"] },
  { id: "shopify", domains: ["shopify.com"] },
  { id: "snapchat", domains: ["snapchat.com"] },
  { id: "stackoverflow", aliases: ["stack overflow"], domains: ["stackoverflow.com", "stackexchange.com"] },
  { id: "telegram", domains: ["telegram.org", "t.me"] },
  { id: "tiktok", domains: ["tiktok.com"] },
  { id: "todoist", domains: ["todoist.com"] },
  { id: "uber", domains: ["uber.com"] },
  { id: "vercel", domains: ["vercel.com"] },
  { id: "vk", domains: ["vk.com"] },
  { id: "whatsapp", domains: ["whatsapp.com"] },
  { id: "wordpress", domains: ["wordpress.com", "wordpress.org"] },
  { id: "youtube", domains: ["youtube.com", "youtu.be"] },
  { id: "zoom", domains: ["zoom.us"] },
];

const popularBrandIds = [
  "google", "microsoft", "azure", "apple", "github", "amazon", "aws", "facebook",
  "instagram", "x", "reddit", "discord", "openai", "linkedin", "slack",
  "dropbox", "spotify", "steam", "twitch", "paypal", "stripe", "netflix",
  "youtube", "whatsapp", "telegram", "tiktok", "1password", "cloudflare",
] as const;

const urlPattern = /[a-z][a-z\d+.-]*:\/\/[^\s<>"'()[\]{}]+/giu;
const bareDomainPattern = /(?:[a-z\d-]+\.)+[a-z]{2,}/giu;

export const serviceBrandSource = GENERATED_SERVICE_BRAND_SOURCE;

export function normalizeServiceBrandValue(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[‐‑‒–—]/gu, "-")
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en");
}

function foldedServiceBrandValue(value: string): string {
  return normalizeServiceBrandValue(value).replace(/[^\p{L}\p{N}]+/gu, "");
}

function asServiceBrandId(value: string): ServiceBrandId {
  return value as ServiceBrandId;
}

function selfhstFamilyMap(): ReadonlyMap<string, GeneratedSelfhstServiceBrandFamily> {
  if (!selfhstFamiliesByReference) {
    selfhstFamiliesByReference = new Map(
      generatedSelfhstServiceBrandFamilies.map((family) => [family[0], family]),
    );
  }
  return selfhstFamiliesByReference;
}

function selfhstBrand(
  family: GeneratedSelfhstServiceBrandFamily,
  variant: (typeof selfhstVariants)[number],
): ResolvedServiceBrand {
  const [reference, title, tags] = family;
  const id = asServiceBrandId(`${SELFHST_ID_PREFIX}${reference}${variant.suffix}`);
  return {
    id,
    title,
    color: variant.suffix === "-light" ? "#202326" : "#f4f3ee",
    source: "selfhst",
    familyId: `${SELFHST_ID_PREFIX}${reference}`,
    variantLabel: variant.label,
    searchTerms: [...new Set([title, reference, ...tags])],
    variantOrder: variant.order,
    asset: `${reference}-alt${variant.suffix}.svg`,
  };
}

function selfhstBrandById(value: unknown): ResolvedServiceBrand | null {
  if (typeof value !== "string" || !value.startsWith(SELFHST_ID_PREFIX)) return null;
  const stem = value.slice(SELFHST_ID_PREFIX.length);
  if (!SELFHST_STEM.test(stem)) return null;

  const families = selfhstFamilyMap();
  const standardFamily = SELFHST_REFERENCE.test(stem) ? families.get(stem) : undefined;
  if (standardFamily && (standardFamily[3] & 1) !== 0) {
    return selfhstBrand(standardFamily, selfhstVariants[0]);
  }
  for (const variant of selfhstVariants.slice(1)) {
    if (!stem.endsWith(variant.suffix)) continue;
    const reference = stem.slice(0, -variant.suffix.length);
    if (!SELFHST_REFERENCE.test(reference)) continue;
    const family = families.get(reference);
    if (family && (family[3] & variant.bit) !== 0) return selfhstBrand(family, variant);
  }
  return null;
}

function isSelfhstBrandId(value: unknown): value is ServiceBrandId {
  return selfhstBrandById(value) !== null;
}

/** All integrated third-party variants, expanded only when a logo picker opens. */
export function selfhstServiceBrandOptions(): readonly ServiceBrandOption[] {
  if (cachedSelfhstBrandOptions) return cachedSelfhstBrandOptions;
  const options: ServiceBrandOption[] = [];
  for (const family of generatedSelfhstServiceBrandFamilies) {
    for (const variant of selfhstVariants) {
      if ((family[3] & variant.bit) === 0) continue;
      const brand = selfhstBrand(family, variant);
      options.push(Object.freeze({
        id: brand.id,
        title: brand.title,
        color: brand.color,
        source: brand.source,
        familyId: brand.familyId,
        variantLabel: brand.variantLabel,
        searchTerms: brand.searchTerms,
        variantOrder: brand.variantOrder,
      }));
    }
  }
  cachedSelfhstBrandOptions = Object.freeze(options);
  return cachedSelfhstBrandOptions;
}

/** A local rendering choice that keeps the account's colored initials tile. */
export const COFFER_INITIALS_BRAND_ID = asServiceBrandId("coffer-initials");

const brandCatalog = new Map<string, CatalogBrand>();
for (const [id, title, color, searchKeys, picker] of generatedServiceBrands) {
  const [familyId, variantLabel, automatic, pickerKeys, variantOrder] = picker ?? [
    id,
    "Brand mark",
    true,
    [],
    0,
  ];
  brandCatalog.set(id, {
    id: asServiceBrandId(id),
    title,
    color,
    asset: `${id}.svg`,
    automatic,
    familyId,
    matchKeys: searchKeys,
    pickerKeys,
    searchTerms: [...new Set([
      ...searchKeys,
      ...pickerKeys,
      normalizeServiceBrandValue(variantLabel),
    ])],
    variantLabel,
    variantOrder,
    source: CURATED_BRAND_IDS.has(id)
      ? "curated"
      : FONT_AWESOME_BRAND_IDS.has(id)
        ? "font-awesome"
        : "simple-icons",
  });
}

for (const rule of curatedMatchRules) {
  const current = brandCatalog.get(rule.id);
  if (!current) continue;
  brandCatalog.set(rule.id, {
    ...current,
    title: rule.title ?? current.title,
    color: rule.color ?? current.color,
    matchKeys: [...new Set([
      ...current.matchKeys,
      ...(rule.aliases ?? []).map(normalizeServiceBrandValue),
    ])],
    searchTerms: [...new Set([
      ...current.searchTerms,
      ...(rule.aliases ?? []).map(normalizeServiceBrandValue),
    ])],
  });
}

export const serviceBrandIds: readonly ServiceBrandId[] = Object.freeze(
  [...brandCatalog.keys()].map(asServiceBrandId),
);

export function isServiceBrandId(value: unknown): value is ServiceBrandId {
  return value === COFFER_INITIALS_BRAND_ID ||
    (typeof value === "string" && (brandCatalog.has(value) || isSelfhstBrandId(value)));
}

export function serviceBrandById(value: string): ResolvedServiceBrand | null {
  const brand = brandCatalog.get(value);
  if (brand) return resolvedBrand(brand);
  return selfhstBrandById(value);
}

function resolvedBrand(brand: CatalogBrand): ResolvedServiceBrand {
  return {
    id: brand.id,
    title: brand.title,
    color: brand.color,
    familyId: brand.familyId,
    searchTerms: brand.searchTerms,
    source: brand.source,
    variantLabel: brand.variantLabel,
    variantOrder: brand.variantOrder,
    asset: brand.asset,
  };
}

function brandOption(brand: CatalogBrand): ServiceBrandOption {
  return {
    id: brand.id,
    title: brand.title,
    color: brand.color,
    familyId: brand.familyId,
    searchTerms: brand.searchTerms,
    source: brand.source,
    variantLabel: brand.variantLabel,
    variantOrder: brand.variantOrder,
  };
}

type MatchValue = string | null;
const exactNameMatches = new Map<string, MatchValue>();
const foldedNameMatches = new Map<string, MatchValue>();

function addMatch(
  matches: Map<string, MatchValue>,
  key: string,
  id: string,
  preferred = false,
): void {
  if (!key) return;
  if (preferred || !matches.has(key)) {
    matches.set(key, id);
  } else if (matches.get(key) !== id) {
    matches.set(key, null);
  }
}

for (const brand of brandCatalog.values()) {
  if (!brand.automatic) continue;
  for (const searchKey of brand.matchKeys) {
    const normalized = normalizeServiceBrandValue(searchKey);
    addMatch(exactNameMatches, normalized, brand.id);
    const folded = foldedServiceBrandValue(normalized);
    if (folded.length >= 2) addMatch(foldedNameMatches, folded, brand.id);
  }
}

for (const rule of curatedMatchRules) {
  if (!brandCatalog.get(rule.id)?.automatic) continue;
  for (const alias of rule.aliases ?? []) {
    const normalized = normalizeServiceBrandValue(alias);
    addMatch(exactNameMatches, normalized, rule.id, true);
    addMatch(foldedNameMatches, foldedServiceBrandValue(normalized), rule.id, true);
  }
}

const decoratedNameMatches = curatedMatchRules
  .filter((rule) => rule.decorated && brandCatalog.get(rule.id)?.automatic)
  .flatMap((rule) => (rule.aliases ?? []).map((alias) => ({
    id: rule.id,
    name: normalizeServiceBrandValue(alias),
  })))
  .filter(({ name }) => foldedServiceBrandValue(name).length >= 3)
  .sort((left, right) => right.name.length - left.name.length);

const domainMatches = curatedMatchRules
  .filter((rule) => brandCatalog.get(rule.id)?.automatic)
  .flatMap((rule) => (rule.domains ?? []).map((domain) => ({
    domain: domain.toLowerCase(),
    id: rule.id,
  })));

function domainCandidates(value: string): {
  domains: string[];
  containsDomainLikeValue: boolean;
} {
  const domains: string[] = [];
  const urlRanges: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;

  urlPattern.lastIndex = 0;
  while ((match = urlPattern.exec(value)) !== null) {
    urlRanges.push({ start: match.index, end: match.index + match[0].length });
    try {
      const parsed = new URL(match[0]);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        domains.push(parsed.hostname);
      }
    } catch {
      // A malformed URL stays domain-like, so it cannot fall through to a name match.
    }
  }

  bareDomainPattern.lastIndex = 0;
  while ((match = bareDomainPattern.exec(value)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (urlRanges.some((range) => start >= range.start && end <= range.end)) continue;
    if (value[start - 1] === "@" || value[end] === "@") continue;
    domains.push(match[0]);
  }

  bareDomainPattern.lastIndex = 0;
  const containsDomainLikeValue = urlRanges.length > 0 || bareDomainPattern.test(value);
  bareDomainPattern.lastIndex = 0;
  return {
    domains: domains.map((domain) => domain.replace(/^www\./u, "").replace(/\.$/u, "")),
    containsDomainLikeValue,
  };
}

function isDomainOrSubdomain(candidate: string, expected: string): boolean {
  return candidate === expected || candidate.endsWith(`.${expected}`);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function containsBoundedName(value: string, name: string): boolean {
  const phrase = escapeRegularExpression(name).replace(/\s+/gu, "\\s+");
  const negated = new RegExp(
    `(?:^|[^\\p{L}\\p{N}.])(?:anti|fake|not|unofficial)[\\s_-]+${phrase}(?=$|[^\\p{L}\\p{N}.])`,
    "iu",
  );
  if (negated.test(value)) return false;
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}.])${phrase}(?=$|[^\\p{L}\\p{N}.])`,
    "iu",
  ).test(value);
}

export function serviceBrandFor(
  service: string,
  brandId?: ServiceBrandId | null,
): ServiceBrandId | null {
  if (brandId === COFFER_INITIALS_BRAND_ID) return null;
  if (brandId && (brandCatalog.has(brandId) || isSelfhstBrandId(brandId))) return brandId;

  const normalized = normalizeServiceBrandValue(service);
  if (!normalized) return null;

  const candidates = domainCandidates(normalized);
  for (const candidate of candidates.domains) {
    const domainMatch = domainMatches.find(({ domain }) => isDomainOrSubdomain(candidate, domain));
    if (domainMatch) return asServiceBrandId(domainMatch.id);
  }

  if (candidates.containsDomainLikeValue || normalized.includes("://")) return null;

  const exact = exactNameMatches.get(normalized);
  if (exact) return asServiceBrandId(exact);

  const folded = foldedServiceBrandValue(normalized);
  const foldedMatch = foldedNameMatches.get(folded);
  if (foldedMatch) return asServiceBrandId(foldedMatch);

  const decorated = decoratedNameMatches.find(({ name }) => containsBoundedName(normalized, name));
  return decorated ? asServiceBrandId(decorated.id) : null;
}

export function resolveServiceBrand(
  service: string,
  brandId?: ServiceBrandId | null,
): ResolvedServiceBrand | null {
  const resolvedId = serviceBrandFor(service, brandId);
  return resolvedId ? serviceBrandById(resolvedId) : null;
}

export function serviceBrandOptions(query = "", limit = 40): readonly ServiceBrandOption[] {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit) || 40));
  const normalized = normalizeServiceBrandValue(query);
  const folded = foldedServiceBrandValue(normalized);

  if (!normalized) {
    const popular = popularBrandIds
      .map((id) => brandCatalog.get(id))
      .filter((brand): brand is CatalogBrand => Boolean(brand));
    const popularIds = new Set(popular.map(({ id }) => id));
    const remaining = [...brandCatalog.values()].filter(({ id }) => !popularIds.has(id));
    return [...popular, ...remaining].slice(0, boundedLimit).map(brandOption);
  }

  return [...brandCatalog.values()]
    .map((brand) => {
      const title = normalizeServiceBrandValue(brand.title);
      const keys = [title, normalizeServiceBrandValue(brand.id), ...brand.matchKeys, ...brand.pickerKeys];
      const exact = keys.some((key) => key === normalized || foldedServiceBrandValue(key) === folded);
      const prefix = normalized.length > 1 && keys.some((key) => key.startsWith(normalized));
      const includes = normalized.length > 1 && keys.some((key) => key.includes(normalized));
      return { brand, score: exact ? 0 : prefix ? 1 : includes ? 2 : 3 };
    })
    .filter(({ score }) => score < 3)
    .sort((left, right) => left.score - right.score || left.brand.title.localeCompare(right.brand.title, "en"))
    .slice(0, boundedLimit)
    .map(({ brand }) => brandOption(brand));
}

export default function ServiceLogo({
  brandId,
  color,
  fallback,
  iconDataUrl,
  service,
}: ServiceLogoProps) {
  const localIconDataUrl = iconDataUrl?.startsWith("data:image/png;base64,") ? iconDataUrl : null;
  if (localIconDataUrl) {
    return (
      <div className="service-logo custom-logo" data-custom-logo="true" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- encrypted data URLs cannot use the image optimizer */}
        <img src={localIconDataUrl} alt="" />
      </div>
    );
  }

  const brand = resolveServiceBrand(service, brandId);

  if (brand) {
    const style: CSSProperties = {
      backgroundColor: brand.color,
      backgroundImage: `url("/brands/${brand.asset}")`,
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundSize: "25px 25px",
      color: "#fff",
    };
    return (
      <div
        className={`service-logo brand-${brand.id}`}
        data-brand-id={brand.id}
        data-brand-source={brand.source}
        style={style}
        aria-hidden="true"
      />
    );
  }

  return <div className={`service-logo ${color}`} aria-hidden="true">{fallback}</div>;
}
