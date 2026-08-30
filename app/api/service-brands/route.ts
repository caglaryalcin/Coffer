import {
  GENERATED_SERVICE_BRAND_SOURCE,
  generatedSelfhstServiceBrandFamilies,
  generatedServiceBrands,
} from "@/app/service-brands.generated";
import { CURATED_SERVICE_BRAND_MATCH_RULES } from "@/app/service-brand-rules";
import { extensionCorsHeaders } from "@/lib/server/extension-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELFHST_ID_PREFIX = "selfhst-";
const selfhstVariants = [
  { bit: 1, suffix: "" },
  { bit: 2, suffix: "-dark" },
  { bit: 4, suffix: "-light" },
] as const;

type PublicServiceBrand = {
  id: string;
  title: string;
  color: `#${string}`;
  asset: string;
  automatic: boolean;
  searchKeys: readonly string[];
  preferredSearchKeys: readonly string[];
  domains: readonly string[];
  decorated: boolean;
};

const curatedRulesById = new Map(CURATED_SERVICE_BRAND_MATCH_RULES.map((rule) => [rule.id, rule]));

const publicCoreServiceBrands: readonly PublicServiceBrand[] = Object.freeze(
  generatedServiceBrands.map(([id, generatedTitle, generatedColor, matchKeys, picker]) => {
    const rule = curatedRulesById.get(id);
    const automatic = picker?.[2] ?? true;
    const pickerKeys = picker?.[3] ?? [];
    const title = rule?.title ?? generatedTitle;
    return Object.freeze({
      id,
      title,
      color: rule?.color ?? generatedColor,
      asset: `${id}.svg`,
      automatic,
      searchKeys: uniqueStrings([id, title, ...matchKeys, ...pickerKeys, ...(rule?.aliases ?? [])]),
      preferredSearchKeys: uniqueStrings(rule?.aliases ?? []),
      domains: uniqueStrings(rule?.domains ?? []),
      decorated: rule?.decorated === true,
    });
  }),
);

const publicServiceBrands: readonly PublicServiceBrand[] = Object.freeze([
  ...publicCoreServiceBrands,
  ...generatedSelfhstServiceBrandFamilies.flatMap(([reference, title, tags, variantMask]) => (
    selfhstVariants
      .filter((variant) => (variantMask & variant.bit) !== 0)
      .map((variant) => Object.freeze({
        id: `${SELFHST_ID_PREFIX}${reference}${variant.suffix}`,
        title,
        color: variant.suffix === "-light" ? "#202326" as const : "#f4f3ee" as const,
        asset: `${reference}-alt${variant.suffix}.svg`,
        automatic: false,
        searchKeys: uniqueStrings([reference, title, ...tags]),
        preferredSearchKeys: [],
        domains: [],
        decorated: false,
      }))
  )),
]);

const extensionServiceBrandBody = JSON.stringify({
  format: "coffer-extension-service-brands",
  version: 1,
  core: publicCoreServiceBrands.map((brand) => [
    brand.id,
    brand.title,
    brand.color,
    brand.automatic,
    brand.searchKeys,
    brand.preferredSearchKeys,
    brand.domains,
    brand.decorated,
  ]),
  selfhst: generatedSelfhstServiceBrandFamilies.map(([reference, title, , variantMask]) => [
    reference,
    title,
    variantMask,
  ]),
});

const fullServiceBrandBody = JSON.stringify({
  // Keep the original public response shape for older extension versions.
  brands: publicServiceBrands.map((brand) => ({
    id: brand.id,
    title: brand.title,
    color: brand.color,
    asset: brand.asset,
    automatic: brand.automatic,
    searchKeys: brand.searchKeys,
  })),
  source: GENERATED_SERVICE_BRAND_SOURCE,
});

export function OPTIONS(request: Request): Response {
  const corsHeaders = extensionCorsHeaders(request, "GET, OPTIONS");
  return new Response(null, { status: 204, headers: responseHeaders(corsHeaders) });
}

export function GET(request: Request): Response {
  const corsHeaders = extensionCorsHeaders(request, "GET, OPTIONS");
  const extensionFormat = new URL(request.url).searchParams.get("format") === "extension-v1";
  return new Response(extensionFormat ? extensionServiceBrandBody : fullServiceBrandBody, {
    headers: responseHeaders(
      corsHeaders,
      extensionFormat
        ? "public, max-age=86400, stale-while-revalidate=604800"
        : "public, max-age=3600",
    ),
  });
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function responseHeaders(
  extra: HeadersInit | null = null,
  cacheControl = "public, max-age=3600",
): HeadersInit {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheControl,
    ...extra,
  };
}
