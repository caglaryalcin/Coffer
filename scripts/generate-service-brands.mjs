import {
  mkdir,
  readFile,
  readdir,
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

if (
  relative(root, brandsDirectory).startsWith("..") ||
  relative(root, curatedAssetsDirectory).startsWith("..") ||
  relative(root, generatedCatalogPath).startsWith("..")
) {
  throw new Error("Generated brand targets must stay inside the project root.");
}

const fontAwesomeIcons = new Map([
  ["amazon", faAmazon],
  ["aws", faAws],
  ["linkedin", faLinkedinIn],
  ["microsoft", faMicrosoft],
  ["openai", faOpenai],
  ["slack", faSlack],
  ["twitter", faTwitter],
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
    !/^[a-z0-9_-]+$/u.test(icon.slug) ||
    typeof icon.hex !== "string" ||
    !/^[a-f\d]{6}$/iu.test(icon.hex)
  ) {
    throw new Error(`Simple Icons contains an unsupported catalog entry: ${JSON.stringify(icon)}`);
  }
  if (seenSlugs.has(icon.slug)) throw new Error(`Duplicate Simple Icons slug: ${icon.slug}`);
  seenSlugs.add(icon.slug);
  generatedBrands.push([
    icon.slug,
    icon.title,
    displayColor(icon.hex.toLowerCase()),
    stringAliases(icon),
  ]);
}

for (const slug of fontAwesomeIcons.keys()) {
  if (!seenSlugs.has(slug)) {
    generatedBrands.push([slug, slug === "aws" ? "Amazon Web Services" : slug, "#222222", [slug]]);
    seenSlugs.add(slug);
  }
}

for (const brand of curatedBrandAssets) {
  if (!/^[a-z0-9_-]+$/u.test(brand.id) || !/^[a-z0-9_-]+\.svg$/u.test(brand.file)) {
    throw new Error(`Curated brand asset has an unsupported id or file name: ${brand.id}`);
  }
  if (seenSlugs.has(brand.id)) {
    throw new Error(`Curated brand asset conflicts with a generated slug: ${brand.id}`);
  }
  generatedBrands.push([
    brand.id,
    brand.title,
    brand.color,
    [...new Set(brand.aliases.map(normalizeSearchKey).filter(Boolean))].sort(),
  ]);
  seenSlugs.add(brand.id);
}

generatedBrands.sort((left, right) => left[0].localeCompare(right[0], "en"));

await mkdir(brandsDirectory, { recursive: true });
const desiredAssets = new Set();
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
} as const;

export const GENERATED_CURATED_SERVICE_BRAND_IDS = ${JSON.stringify(curatedBrandAssets.map(({ id }) => id))} as const;

export type GeneratedServiceBrand = readonly [
  id: string,
  title: string,
  displayColor: \`#\${string}\`,
  searchKeys: readonly string[],
];

export const generatedServiceBrands = JSON.parse(
  ${JSON.stringify(catalogJson)},
) as readonly GeneratedServiceBrand[];
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

Brand names and logos may be trademarks of their respective owners. Inclusion does not imply endorsement.
`;
await writeFile(join(brandsDirectory, "LICENSES.txt"), licenses, "utf8");

const totalSvgBytes = (await Promise.all(
  [...desiredAssets].map(async (file) => (await readFile(join(brandsDirectory, file))).byteLength),
)).reduce((sum, size) => sum + size, 0);
console.log(`Generated ${generatedBrands.length} local brand icons (${totalSvgBytes} bytes).`);
