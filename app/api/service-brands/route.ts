import {
  GENERATED_SERVICE_BRAND_SOURCE,
  generatedSelfhstServiceBrandFamilies,
  generatedServiceBrands,
} from "@/app/service-brands.generated";
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
};

const publicServiceBrands: readonly PublicServiceBrand[] = Object.freeze([
  ...generatedServiceBrands.map(([id, title, color, matchKeys, picker]) => {
    const automatic = picker?.[2] ?? true;
    const pickerKeys = picker?.[3] ?? [];
    return Object.freeze({
      id,
      title,
      color,
      asset: `${id}.svg`,
      automatic,
      searchKeys: uniqueStrings([id, title, ...matchKeys, ...pickerKeys]),
    });
  }),
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
      }))
  )),
]);

export function OPTIONS(request: Request): Response {
  const corsHeaders = extensionCorsHeaders(request, "GET, OPTIONS");
  return new Response(null, { status: 204, headers: responseHeaders(corsHeaders) });
}

export function GET(request: Request): Response {
  const corsHeaders = extensionCorsHeaders(request, "GET, OPTIONS");
  return new Response(JSON.stringify({
    brands: publicServiceBrands,
    source: GENERATED_SERVICE_BRAND_SOURCE,
  }), {
    headers: responseHeaders(corsHeaders),
  });
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function responseHeaders(extra: HeadersInit | null = null): HeadersInit {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
    ...extra,
  };
}
