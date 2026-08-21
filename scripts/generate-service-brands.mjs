import {
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  faAmazon,
  faAws,
  faLinkedinIn,
  faMicrosoft,
  faOpenai,
  faSlack,
  faTwitter,
} from "@fortawesome/free-brands-svg-icons";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const simpleIconsRoot = join(root, "node_modules", "simple-icons");
const simpleIconsPackage = JSON.parse(
  await readFile(join(simpleIconsRoot, "package.json"), "utf8"),
);
const simpleIconsLicense = String(simpleIconsPackage.license);
const simpleIconsVersion = String(simpleIconsPackage.version);
const iconData = JSON.parse(
  await readFile(join(simpleIconsRoot, "data", "simple-icons.json"), "utf8"),
);
const brandsDirectory = resolve(root, "public", "brands");
const curatedAssetsDirectory = resolve(root, "scripts", "brand-assets");
const generatedCatalogPath = resolve(root, "app", "service-brands.generated.ts");
const selfhstCatalogPath = resolve(root, "scripts", "selfhst-icons.generated.json");
const selfhstLicensePath = resolve(brandsDirectory, "selfhst-LICENSE.txt");
const selfhstAttributionPath = resolve(brandsDirectory, "selfhst-ATTRIBUTION.txt");
const selfhstSource = {
  repository: "https://github.com/selfhst/icons",
  revision: "948e3aa28d3110ee23957473a85431650e10e778",
  version: "4.0.3",
  license: "CC-BY-4.0",
};
const EXPECTED_SELFHST_FAMILY_COUNT = 2_445;
const EXPECTED_SELFHST_SVG_COUNT = 7_146;
const selfhstVariants = [
  { bit: 1, suffix: "" },
  { bit: 2, suffix: "-dark" },
  { bit: 4, suffix: "-light" },
];

function exactObjectKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index]);
}

function integratedSelfhstAssets(value) {
  if (
    !exactObjectKeys(value, ["families", "source", "version"]) ||
    value.version !== 1 ||
    !exactObjectKeys(value.source, ["commit", "license", "repository"]) ||
    value.source.repository !== selfhstSource.repository ||
    value.source.commit !== selfhstSource.revision ||
    value.source.license !== selfhstSource.license ||
    !Array.isArray(value.families) ||
    value.families.length !== EXPECTED_SELFHST_FAMILY_COUNT
  ) {
    throw new Error("The integrated selfh.st icon catalog is invalid or does not match the pinned source.");
  }

  const references = new Set();
  const assets = new Set();
  for (const family of value.families) {
    if (!Array.isArray(family) || family.length !== 4) {
      throw new Error("The integrated selfh.st icon catalog contains an invalid family entry.");
    }
    const [reference, title, searchTerms, variantMask] = family;
    if (
      typeof reference !== "string" ||
      !/^[a-z0-9][a-z0-9-]{0,49}$/u.test(reference) ||
      references.has(reference) ||
      typeof title !== "string" ||
      title !== title.trim() ||
      !title ||
      !Array.isArray(searchTerms) ||
      searchTerms.some((term) => typeof term !== "string" || !term.trim()) ||
      !Number.isInteger(variantMask) ||
      variantMask < 1 ||
      variantMask > 7 ||
      (variantMask & 1) === 0
    ) {
      throw new Error(`The integrated selfh.st icon catalog contains invalid metadata for ${String(reference)}.`);
    }
    references.add(reference);
    for (const variant of selfhstVariants) {
      if ((variantMask & variant.bit) === 0) continue;
      const filename = `selfhst-${reference}${variant.suffix}.svg`;
      if (!/^[a-z0-9][a-z0-9-]{0,63}\.svg$/u.test(filename) || assets.has(filename)) {
        throw new Error(`The integrated selfh.st icon catalog contains an invalid asset: ${filename}`);
      }
      assets.add(filename);
    }
  }
  if (assets.size !== EXPECTED_SELFHST_SVG_COUNT) {
    throw new Error(`Expected ${EXPECTED_SELFHST_SVG_COUNT} integrated selfh.st SVGs, found ${assets.size}.`);
  }
  return assets;
}

async function totalAssetBytes(files) {
  const filenames = [...files];
  let total = 0;
  const batchSize = 64;
  for (let index = 0; index < filenames.length; index += batchSize) {
    const sizes = await Promise.all(
      filenames.slice(index, index + batchSize).map(async (file) => (await stat(join(brandsDirectory, file))).size),
    );
    total += sizes.reduce((sum, size) => sum + size, 0);
  }
  return total;
}

const curatedBrandAssets = [
  {
    aliases: ["azure", "microsoft azure"],
    color: "#ffffff",
    file: "azure.svg",
    id: "azure",
    provider: "Microsoft",
    terms: "Microsoft Trademark and Brand Guidelines",
    termsUrl: "https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks",
    title: "Microsoft Azure",
  },
];
const curatedBrandAssetsById = new Map(curatedBrandAssets.map((brand) => [brand.id, brand]));

// Picker-only metadata keeps related marks and true variants data-driven. New
// light/dark/classic assets can join an existing family without adding UI
// conditionals. `automatic: false` keeps explicit variants out of name matching.
const brandPickerMetadata = new Map([
  ["azure", {
    automatic: true,
    variantLabel: "Azure color mark",
    pickerKeys: ["azure", "microsoft azure", "microsoft"],
  }],
  ["microsoft", {
    automatic: true,
    variantLabel: "Four-square Microsoft mark",
    pickerKeys: ["azure", "microsoft azure"],
    variantOrder: 1,
  }],
  ["x", {
    automatic: true,
    familyId: "x-twitter",
    variantLabel: "Current X mark",
    pickerKeys: ["x", "twitter"],
  }],
  ["twitter", {
    automatic: true,
    familyId: "x-twitter",
    variantLabel: "Classic Twitter mark",
    pickerKeys: ["x", "twitter"],
    variantOrder: 1,
  }],
]);

if (
  relative(root, brandsDirectory).startsWith("..") ||
  relative(root, curatedAssetsDirectory).startsWith("..") ||
  relative(root, generatedCatalogPath).startsWith("..") ||
  relative(root, selfhstCatalogPath).startsWith("..") ||
  relative(brandsDirectory, selfhstLicensePath).startsWith("..") ||
  relative(brandsDirectory, selfhstAttributionPath).startsWith("..")
) {
  throw new Error("Generated brand targets must stay inside the project root.");
}

const selfhstCatalog = JSON.parse(await readFile(selfhstCatalogPath, "utf8"));
const selfhstAssetFilenames = integratedSelfhstAssets(selfhstCatalog);
await Promise.all([
  readFile(selfhstLicensePath),
  readFile(selfhstAttributionPath),
]);

const fontAwesomeIcons = new Map([
  ["amazon", faAmazon],
  ["aws", faAws],
  ["linkedin", faLinkedinIn],
  ["microsoft", faMicrosoft],
  ["openai", faOpenai],
  ["slack", faSlack],
  ["twitter", faTwitter],
]);
const fontAwesomeTitles = new Map([
  ["amazon", "Amazon"],
  ["aws", "Amazon Web Services"],
  ["linkedin", "LinkedIn"],
  ["microsoft", "Microsoft"],
  ["openai", "OpenAI"],
  ["slack", "Slack"],
  ["twitter", "Twitter"],
]);

function normalizeSearchKey(value) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/[‐‑‒–—]/gu, "-")
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en");
}

function stringAliases(icon) {
  const aliases = [icon.title];
  for (const value of icon.aliases?.aka ?? []) aliases.push(value);
  for (const value of icon.aliases?.old ?? []) aliases.push(value);
  for (const duplicate of icon.aliases?.dup ?? []) {
    if (typeof duplicate?.title === "string") aliases.push(duplicate.title);
  }
  for (const value of Object.values(icon.aliases?.loc ?? {})) {
    if (typeof value === "string") aliases.push(value);
  }
  return [...new Set(aliases.map(normalizeSearchKey).filter(Boolean))].sort();
}

function generatedBrand(id, title, color, searchKeys) {
  const picker = brandPickerMetadata.get(id);
  const record = [id, title, color, searchKeys];
  if (picker) {
    if (typeof picker.automatic !== "boolean") {
      throw new Error(`Picker metadata has an invalid automatic flag: ${id}`);
    }
    if (
      picker.pickerKeys !== undefined &&
      (!Array.isArray(picker.pickerKeys) || picker.pickerKeys.some((key) => typeof key !== "string" || !key.trim()))
    ) {
      throw new Error(`Picker metadata has invalid search keys: ${id}`);
    }
    record.push([
      picker.familyId ?? id,
      picker.variantLabel ?? "Brand mark",
      picker.automatic,
      [...new Set((picker.pickerKeys ?? []).map(normalizeSearchKey).filter(Boolean))].sort(),
      picker.variantOrder ?? 0,
    ]);
  }
  return record;
}

function channel(value) {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function displayColor(sourceHex) {
  let red = Number.parseInt(sourceHex.slice(0, 2), 16);
  let green = Number.parseInt(sourceHex.slice(2, 4), 16);
  let blue = Number.parseInt(sourceHex.slice(4, 6), 16);
  while (luminance(
    [red, green, blue].map((value) => Math.round(value).toString(16).padStart(2, "0")).join(""),
  ) > 0.28) {
    red *= 0.86;
    green *= 0.86;
    blue *= 0.86;
  }
  return `#${[red, green, blue]
    .map((value) => Math.round(value).toString(16).padStart(2, "0"))
    .join("")}`;
}

function simpleIconSvg(icon, source) {
  const viewBox = source.match(/viewBox="([^"]+)"/u)?.[1] ?? "0 0 24 24";
  const paths = [...source.matchAll(/<path d="([^"]+)"\s*\/?\s*>/gu)].map((match) => match[1]);
  if (paths.length === 0) throw new Error(`Simple Icons asset has no path: ${icon.slug}`);
  const pathMarkup = paths.map((path) => `<path d="${path}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="#fff" role="img"><!-- Simple Icons ${simpleIconsVersion}; ${simpleIconsLicense}; slug=${icon.slug} -->${pathMarkup}</svg>\n`;
}

function fontAwesomeSvg(slug, icon) {
  const [width, height, , , rawPath] = icon.icon;
  const paths = (Array.isArray(rawPath) ? rawPath : [rawPath])
    .map((path) => `<path d="${path}"/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="#fff" role="img"><!-- Font Awesome Free 7.3.1 Brands; Icons CC BY 4.0; slug=${slug} -->${paths}</svg>\n`;
}

function validateCuratedSvg(brand, source) {
  if (!/^\s*<svg(?:\s|>)/u.test(source)) {
    throw new Error(`Curated brand asset is not an SVG document: ${brand.file}`);
  }
  if (
    /<(?:foreignObject|script)\b/iu.test(source) ||
    /\bon[a-z]+\s*=/iu.test(source) ||
    /\b(?:href|xlink:href)\s*=\s*["'](?!#)/iu.test(source)
  ) {
    throw new Error(`Curated brand asset contains active or external content: ${brand.file}`);
  }
}

if (!Array.isArray(iconData) || iconData.length < 3_000) {
  throw new Error("The pinned Simple Icons catalog is missing or unexpectedly small.");
}

const seenSlugs = new Set();
const generatedBrands = [];
for (const icon of iconData) {
  if (
    !icon ||
    typeof icon.title !== "string" ||
    typeof icon.slug !== "string" ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(icon.slug) ||
    typeof icon.hex !== "string" ||
    !/^[a-f\d]{6}$/iu.test(icon.hex)
  ) {
    throw new Error(`Simple Icons contains an unsupported catalog entry: ${JSON.stringify(icon)}`);
  }
  if (icon.slug.startsWith("selfhst-")) {
    throw new Error(`Simple Icons conflicts with Coffer's reserved integrated-icon namespace: ${icon.slug}`);
  }
  if (seenSlugs.has(icon.slug)) throw new Error(`Duplicate Simple Icons slug: ${icon.slug}`);
  seenSlugs.add(icon.slug);
  generatedBrands.push(generatedBrand(
    icon.slug,
    icon.title,
    displayColor(icon.hex.toLowerCase()),
    stringAliases(icon),
  ));
}

for (const slug of fontAwesomeIcons.keys()) {
  if (!seenSlugs.has(slug)) {
    generatedBrands.push(generatedBrand(slug, fontAwesomeTitles.get(slug) ?? slug, "#222222", [slug]));
    seenSlugs.add(slug);
  }
}

for (const brand of curatedBrandAssets) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(brand.id) || brand.file !== `${brand.id}.svg`) {
    throw new Error(`Curated brand asset has an unsupported id or file name: ${brand.id}`);
  }
  if (seenSlugs.has(brand.id)) {
    throw new Error(`Curated brand asset conflicts with a generated slug: ${brand.id}`);
  }
  generatedBrands.push(generatedBrand(
    brand.id,
    brand.title,
    brand.color,
    [...new Set(brand.aliases.map(normalizeSearchKey).filter(Boolean))].sort(),
  ));
  seenSlugs.add(brand.id);
}

for (const [id, picker] of brandPickerMetadata) {
  if (!seenSlugs.has(id)) throw new Error(`Picker metadata references an unknown brand: ${id}`);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(picker.familyId ?? id)) {
    throw new Error(`Picker metadata has an unsupported family id: ${picker.familyId ?? id}`);
  }
  if (typeof (picker.variantLabel ?? "Brand mark") !== "string" || !(picker.variantLabel ?? "Brand mark").trim()) {
    throw new Error(`Picker metadata has an invalid variant label: ${id}`);
  }
  if (!Number.isInteger(picker.variantOrder ?? 0) || (picker.variantOrder ?? 0) < 0) {
    throw new Error(`Picker metadata has an invalid variant order: ${id}`);
  }
}

generatedBrands.sort((left, right) => left[0].localeCompare(right[0], "en"));

await mkdir(brandsDirectory, { recursive: true });
const desiredAssets = new Set(selfhstAssetFilenames);
for (const brand of generatedBrands) {
  const slug = brand[0];
  desiredAssets.add(`${slug}.svg`);
  const curated = curatedBrandAssetsById.get(slug);
  if (curated) {
    const source = await readFile(join(curatedAssetsDirectory, curated.file), "utf8");
    validateCuratedSvg(curated, source);
    await writeFile(join(brandsDirectory, curated.file), source, "utf8");
    continue;
  }
  const fontAwesome = fontAwesomeIcons.get(slug);
  let svg;
  if (fontAwesome) {
    svg = fontAwesomeSvg(slug, fontAwesome);
  } else {
    const source = await readFile(join(simpleIconsRoot, "icons", `${slug}.svg`), "utf8");
    svg = simpleIconSvg({ slug }, source);
  }
  await writeFile(join(brandsDirectory, `${slug}.svg`), svg, "utf8");
}

for (const file of await readdir(brandsDirectory)) {
  if (file.endsWith(".svg") && !desiredAssets.has(file)) {
    await unlink(join(brandsDirectory, file));
  }
}

const catalogJson = JSON.stringify(generatedBrands);
const selfhstFamiliesJson = JSON.stringify(selfhstCatalog.families);
const generatedSource = `/* This file is generated by scripts/generate-service-brands.mjs. */
export const GENERATED_SERVICE_BRAND_SOURCE = {
  package: "simple-icons",
  version: ${JSON.stringify(simpleIconsVersion)},
  license: ${JSON.stringify(simpleIconsLicense)},
  fontAwesome: {
    package: "@fortawesome/free-brands-svg-icons",
    version: "7.3.1",
    iconLicense: "CC-BY-4.0",
  },
  curated: ${JSON.stringify(curatedBrandAssets.map((brand) => ({
    id: brand.id,
    provider: brand.provider,
    terms: brand.terms,
    termsUrl: brand.termsUrl,
  })))},
  selfhst: ${JSON.stringify(selfhstSource)},
} as const;

export const GENERATED_CURATED_SERVICE_BRAND_IDS = ${JSON.stringify(curatedBrandAssets.map(({ id }) => id))} as const;

export type GeneratedServiceBrand = readonly [
  id: string,
  title: string,
  displayColor: \`#\${string}\`,
  searchKeys: readonly string[],
  picker?: readonly [
    familyId: string,
    variantLabel: string,
    automatic: boolean,
    pickerKeys: readonly string[],
    variantOrder: number,
  ],
];

export const generatedServiceBrands = JSON.parse(
  ${JSON.stringify(catalogJson)},
) as readonly GeneratedServiceBrand[];

export type GeneratedSelfhstServiceBrandFamily = readonly [
  reference: string,
  title: string,
  searchTerms: readonly string[],
  variantMask: number,
];

export const generatedSelfhstServiceBrandFamilies = JSON.parse(
  ${JSON.stringify(selfhstFamiliesJson)},
) as readonly GeneratedSelfhstServiceBrandFamily[];
`;
await writeFile(generatedCatalogPath, generatedSource, "utf8");

const licenses = `Coffer local service-brand assets
=================================

Generated from Simple Icons ${simpleIconsVersion} (${simpleIconsLicense}).
Source metadata and upstream provenance are pinned in node_modules/simple-icons/data/simple-icons.json.
Simple Icons project: https://simpleicons.org

The following curated compatibility assets use Font Awesome Free Brands 7.3.1:
${[...fontAwesomeIcons.keys()].sort().join(", ")}
Icons license: CC BY 4.0. Font Awesome project: https://fontawesome.com

The following manually curated local assets are proprietary brand assets and are not
covered by the Simple Icons, Font Awesome, or Coffer licenses:
${curatedBrandAssets.map((brand) => `${brand.id} (${brand.title}): ${brand.provider}; ${brand.terms}; ${brand.termsUrl}`).join("\n")}

Additional selectable service-icon variants are vendored from selfh.st/icons ${selfhstSource.version}:
Project: ${selfhstSource.repository}
Snapshot: ${selfhstSource.revision}
License: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/
Full license and attribution: /brands/selfhst-LICENSE.txt and /brands/selfhst-ATTRIBUTION.txt

The upstream filenames were prefixed with selfhst- for collision-safe integration.
The empty Adobe Illustrator compatibility foreignObject in selfhst-paypal-light.svg
was removed during the security-preserving import. No other visual modifications were made.

Brand names and logos may be trademarks of their respective owners. Inclusion does not imply endorsement.
`;
await writeFile(join(brandsDirectory, "LICENSES.txt"), licenses, "utf8");

const totalSvgBytes = await totalAssetBytes(desiredAssets);
console.log(
  `Prepared ${desiredAssets.size} local brand icons (${generatedBrands.length} core + ${selfhstAssetFilenames.size} integrated; ${totalSvgBytes} bytes).`,
);
