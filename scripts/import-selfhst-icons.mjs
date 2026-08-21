import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_REPOSITORY = "https://github.com/selfhst/icons";
const SOURCE_COMMIT = "948e3aa28d3110ee23957473a85431650e10e778";
const SOURCE_LICENSE = "CC-BY-4.0";
const EXPECTED_SVG_COUNT = 7_146;
const EXPECTED_FAMILY_COUNT = 2_445;

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const brandsRoot = resolve(projectRoot, "public", "brands");
const legacyOutputRoot = resolve(brandsRoot, "selfhst");
const legacyPublicCatalogPath = resolve(brandsRoot, "selfhst-catalog.json");
const catalogOutputPath = resolve(scriptDirectory, "selfhst-icons.generated.json");
const licenseOutputPath = resolve(brandsRoot, "selfhst-LICENSE.txt");
const attributionOutputPath = resolve(brandsRoot, "selfhst-ATTRIBUTION.txt");
const OUTPUT_PREFIX = "selfhst-";

const allowedElements = new Set([
  "circle",
  "clipPath",
  "defs",
  "ellipse",
  "feColorMatrix",
  "feGaussianBlur",
  "feMerge",
  "feMergeNode",
  "filter",
  "g",
  "linearGradient",
  "mask",
  "path",
  "pattern",
  "radialGradient",
  "rect",
  "stop",
  "style",
  "svg",
  "switch",
  "text",
  "use",
]);

const fallbackMetadata = new Map([
  ["hoarder", { title: "Hoarder", searchTerms: ["Karakeep"] }],
  ["plex-dash", { title: "Plex Dash", searchTerms: ["Plex"] }],
  ["plex-photos", { title: "Plex Photos", searchTerms: ["Plex"] }],
  ["sonarr-4k", { title: "Sonarr 4K", searchTerms: ["Sonarr", "4K"] }],
  ["sonarr-anime", { title: "Sonarr Anime", searchTerms: ["Sonarr", "Anime"] }],
]);

const paypalForeignObject =
  '<foreignObject width="1" height="1" x="0" y="0" requiredExtensions="http://ns.adobe.com/AdobeIllustrator/10.0/"/>';

function fail(message) {
  throw new Error(message);
}

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function runGit(sourceRoot, args, options = {}) {
  const result = spawnSync("git", ["-C", sourceRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });

  if (result.error) {
    fail(`Could not run git: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    fail(`git ${args.join(" ")} failed: ${detail}`);
  }

  return result.stdout.trim();
}

function readGitBlob(sourceRoot, repositoryPath) {
  try {
    return execFileSync(
      "git",
      ["-C", sourceRoot, "show", `${SOURCE_COMMIT}:${repositoryPath}`],
      { maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (error) {
    fail(`Could not read ${repositoryPath} from ${SOURCE_COMMIT}: ${error.message}`);
  }
}

function decodeUtf8(buffer, filename) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    fail(`${filename} is not valid UTF-8.`);
  }
}

function decodeXmlEntities(value, filename) {
  const decoded = value.replace(
    /&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,
    (entity, name) => {
      const normalized = name.toLowerCase();
      if (normalized === "amp") return "&";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      if (normalized === "quot") return '"';
      if (normalized === "apos") return "'";

      const codePoint = normalized.startsWith("#x")
        ? Number.parseInt(normalized.slice(2), 16)
        : Number.parseInt(normalized.slice(1), 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        fail(`${filename} contains an invalid XML character reference.`);
      }
      return String.fromCodePoint(codePoint);
    },
  );

  if (/&(?:#|[a-z])/i.test(decoded)) {
    fail(`${filename} contains an unsupported XML entity.`);
  }
  return decoded;
}

function validatePassiveCss(css, filename) {
  if (/@import\b|expression\s*\(|-moz-binding\s*:|behavior\s*:/i.test(css)) {
    fail(`${filename} contains an active CSS construct.`);
  }

  const urlPattern = /url\s*\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi;
  let match;
  let lastIndex = 0;
  while ((match = urlPattern.exec(css)) !== null) {
    const target = (match[2] ?? match[3] ?? "").trim();
    if (!/^#[a-z0-9_.:-]+$/i.test(target)) {
      fail(`${filename} contains a non-local CSS URL.`);
    }
    lastIndex = urlPattern.lastIndex;
  }

  const withoutValidUrls = css.replace(urlPattern, "");
  if (/url\s*\(/i.test(withoutValidUrls) || (lastIndex === 0 && /url\s*\(/i.test(css))) {
    fail(`${filename} contains a malformed CSS URL.`);
  }
}

function findTagEnd(svg, start, filename) {
  let quote = "";
  for (let index = start; index < svg.length; index += 1) {
    const character = svg[index];
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  fail(`${filename} contains an unterminated XML tag.`);
}

function parseStartTag(rawTag, filename) {
  let content = rawTag.trim();
  const selfClosing = content.endsWith("/");
  if (selfClosing) content = content.slice(0, -1).trimEnd();

  const nameMatch = /^([A-Za-z][A-Za-z0-9:_-]*)/.exec(content);
  if (!nameMatch) fail(`${filename} contains an invalid element name.`);
  const name = nameMatch[1];
  let cursor = nameMatch[0].length;
  const attributes = new Map();

  while (cursor < content.length) {
    while (/\s/.test(content[cursor] ?? "")) cursor += 1;
    if (cursor >= content.length) break;

    const attributeMatch = /^([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(content.slice(cursor));
    if (!attributeMatch) fail(`${filename} contains an invalid attribute name on <${name}>.`);
    const attributeName = attributeMatch[1];
    cursor += attributeMatch[0].length;
    while (/\s/.test(content[cursor] ?? "")) cursor += 1;
    if (content[cursor] !== "=") {
      fail(`${filename} contains an unquoted or valueless ${attributeName} attribute.`);
    }
    cursor += 1;
    while (/\s/.test(content[cursor] ?? "")) cursor += 1;
    const quote = content[cursor];
    if (quote !== '"' && quote !== "'") {
      fail(`${filename} contains an unquoted ${attributeName} attribute.`);
    }
    cursor += 1;
    const valueEnd = content.indexOf(quote, cursor);
    if (valueEnd === -1) fail(`${filename} contains an unterminated ${attributeName} attribute.`);
    const value = content.slice(cursor, valueEnd);
    cursor = valueEnd + 1;

    if (attributes.has(attributeName)) {
      fail(`${filename} contains a duplicate ${attributeName} attribute.`);
    }
    attributes.set(attributeName, value);
  }

  return { attributes, name, selfClosing };
}

function validateAttributes(attributes, filename) {
  for (const [name, rawValue] of attributes) {
    const normalizedName = name.toLowerCase();
    const localName = normalizedName.split(":").at(-1);
    const value = decodeXmlEntities(rawValue, filename);

    if (/^on[a-z]/i.test(localName)) {
      fail(`${filename} contains an event-handler attribute.`);
    }
    if (["src", "data", "poster", "action", "formaction"].includes(localName)) {
      fail(`${filename} contains the external-resource attribute ${name}.`);
    }
    if (normalizedName === "xml:base") {
      fail(`${filename} contains xml:base.`);
    }
    if (localName === "href" && !/^#[a-z0-9_.:-]+$/i.test(value.trim())) {
      fail(`${filename} contains a non-local href.`);
    }

    const namespaceDeclaration = normalizedName === "xmlns" || normalizedName.startsWith("xmlns:");
    if (
      !namespaceDeclaration &&
      /(?:javascript|vbscript|data|file|https?):|^\s*\/\//i.test(value)
    ) {
      fail(`${filename} contains an external or active attribute value.`);
    }

    validatePassiveCss(value, filename);
  }
}

function validatePassiveSvg(svg, filename) {
  if (!svg || !svg.includes("<svg")) fail(`${filename} does not contain an SVG root.`);
  for (const character of svg) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint <= 0x08 ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      codePoint === 0x7f
    ) {
      fail(`${filename} contains a disallowed control character.`);
    }
  }
  if (/<!DOCTYPE\b|<!ENTITY\b|<\?xml-stylesheet\b/i.test(svg)) {
    fail(`${filename} contains an active XML declaration.`);
  }
  if (/\b(?:javascript|vbscript)\s*:/i.test(decodeXmlEntities(svg, filename))) {
    fail(`${filename} contains an active URI scheme.`);
  }

  validatePassiveCss(decodeXmlEntities(svg, filename), filename);

  const stack = [];
  let cursor = 0;
  let rootCount = 0;
  let rootClosed = false;

  while (cursor < svg.length) {
    const tagStart = svg.indexOf("<", cursor);
    const textEnd = tagStart === -1 ? svg.length : tagStart;
    const text = svg.slice(cursor, textEnd);
    if (stack.length === 0 && text.trim()) {
      fail(`${filename} contains content outside its SVG root.`);
    }
    if (stack.at(-1) === "style") {
      validatePassiveCss(decodeXmlEntities(text, filename), filename);
    }
    if (tagStart === -1) break;

    if (svg.startsWith("<!--", tagStart)) {
      const commentEnd = svg.indexOf("-->", tagStart + 4);
      if (commentEnd === -1) fail(`${filename} contains an unterminated comment.`);
      cursor = commentEnd + 3;
      continue;
    }
    if (svg.startsWith("<![CDATA[", tagStart)) {
      if (stack.at(-1) !== "style") fail(`${filename} contains CDATA outside <style>.`);
      const cdataEnd = svg.indexOf("]]>", tagStart + 9);
      if (cdataEnd === -1) fail(`${filename} contains unterminated CDATA.`);
      validatePassiveCss(svg.slice(tagStart + 9, cdataEnd), filename);
      cursor = cdataEnd + 3;
      continue;
    }
    if (svg.startsWith("<?", tagStart)) {
      const instructionEnd = svg.indexOf("?>", tagStart + 2);
      if (
        instructionEnd === -1 ||
        rootCount !== 0 ||
        !/^<\?xml\s+version=(?:"1\.0"|'1\.0')(?:\s+encoding=(?:"UTF-8"|'UTF-8'))?\s*\?>$/i.test(
          svg.slice(tagStart, instructionEnd + 2),
        )
      ) {
        fail(`${filename} contains a disallowed processing instruction.`);
      }
      cursor = instructionEnd + 2;
      continue;
    }
    if (svg.startsWith("<!", tagStart)) {
      fail(`${filename} contains a disallowed XML declaration.`);
    }

    const tagEnd = findTagEnd(svg, tagStart + 1, filename);
    const rawTag = svg.slice(tagStart + 1, tagEnd);
    if (rawTag.trimStart().startsWith("/")) {
      const closingMatch = /^\/\s*([A-Za-z][A-Za-z0-9:_-]*)\s*$/.exec(rawTag.trim());
      if (!closingMatch || stack.pop() !== closingMatch[1]) {
        fail(`${filename} contains mismatched closing tags.`);
      }
      if (stack.length === 0) rootClosed = true;
      cursor = tagEnd + 1;
      continue;
    }

    if (rootClosed) fail(`${filename} contains multiple root elements.`);
    const parsed = parseStartTag(rawTag, filename);
    if (!allowedElements.has(parsed.name)) {
      fail(`${filename} contains disallowed <${parsed.name}> content.`);
    }
    validateAttributes(parsed.attributes, filename);

    if (stack.length === 0) {
      rootCount += 1;
      if (parsed.name !== "svg" || rootCount !== 1) {
        fail(`${filename} has an invalid root element.`);
      }
    }

    if (!parsed.selfClosing) stack.push(parsed.name);
    else if (stack.length === 0) rootClosed = true;
    cursor = tagEnd + 1;
  }

  if (stack.length !== 0 || rootCount !== 1 || !rootClosed) {
    fail(`${filename} contains incomplete XML structure.`);
  }
}

function sanitizeSvg(filename, source) {
  if (filename !== "paypal-light.svg") return { modified: false, source };

  const firstIndex = source.indexOf(paypalForeignObject);
  if (firstIndex === -1 || source.indexOf(paypalForeignObject, firstIndex + 1) !== -1) {
    fail("paypal-light.svg does not contain exactly one expected empty foreignObject.");
  }
  return {
    modified: true,
    source: source.slice(0, firstIndex) + source.slice(firstIndex + paypalForeignObject.length),
  };
}

function uniqueSearchTerms(tags, title, reference) {
  const excluded = new Set([title.toLocaleLowerCase("en-US"), reference.toLowerCase()]);
  const seen = new Set();
  const terms = [];
  for (const rawTerm of tags) {
    const term = rawTerm.trim();
    const key = term.toLocaleLowerCase("en-US");
    if (!term || excluded.has(key) || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms.sort((left, right) => compareOrdinal(left.toLowerCase(), right.toLowerCase()));
}

function buildCatalog(svgFilenames, upstreamIndex) {
  if (!Array.isArray(upstreamIndex)) fail("Upstream index.json is not an array.");

  const indexedFamilies = new Map();
  for (const item of upstreamIndex) {
    if (item?.SVG !== "Yes") continue;
    if (
      typeof item.Reference !== "string" ||
      !/^[a-z0-9][a-z0-9-]*$/.test(item.Reference) ||
      typeof item.Name !== "string" ||
      !item.Name.trim()
    ) {
      fail("Upstream index.json contains invalid SVG metadata.");
    }
    if (indexedFamilies.has(item.Reference)) {
      fail(`Upstream index.json contains duplicate reference ${item.Reference}.`);
    }
    indexedFamilies.set(item.Reference, item);
  }

  const filenameSet = new Set(svgFilenames);
  const standardReferences = svgFilenames
    .filter((filename) => !filename.endsWith("-dark.svg") && !filename.endsWith("-light.svg"))
    .map((filename) => filename.slice(0, -4))
    .sort(compareOrdinal);

  if (standardReferences.length !== EXPECTED_FAMILY_COUNT) {
    fail(`Expected ${EXPECTED_FAMILY_COUNT} standard SVGs, found ${standardReferences.length}.`);
  }

  const assignedFiles = new Set();
  const families = standardReferences.map((reference) => {
    const standardFilename = `${reference}.svg`;
    const darkFilename = `${reference}-dark.svg`;
    const lightFilename = `${reference}-light.svg`;
    let variantMask = 1;
    assignedFiles.add(standardFilename);
    if (filenameSet.has(darkFilename)) {
      variantMask |= 2;
      assignedFiles.add(darkFilename);
    }
    if (filenameSet.has(lightFilename)) {
      variantMask |= 4;
      assignedFiles.add(lightFilename);
    }

    const indexed = indexedFamilies.get(reference);
    const fallback = fallbackMetadata.get(reference);
    if (!indexed && !fallback) fail(`No catalog metadata is available for ${reference}.`);

    const title = indexed?.Name.trim() ?? fallback.title;
    const rawTags = indexed
      ? String(indexed.Tags ?? "").split(",")
      : fallback.searchTerms;
    const searchTerms = uniqueSearchTerms(rawTags, title, reference);
    return [reference, title, searchTerms, variantMask];
  });

  const unassigned = svgFilenames.filter((filename) => !assignedFiles.has(filename));
  if (unassigned.length > 0) {
    fail(`SVG variants without a standard family: ${unassigned.join(", ")}`);
  }

  return {
    version: 1,
    source: {
      repository: SOURCE_REPOSITORY,
      commit: SOURCE_COMMIT,
      license: SOURCE_LICENSE,
    },
    families,
  };
}

function attributionText() {
  return `selfh.st/icons SVG collection

Source: ${SOURCE_REPOSITORY}
Pinned commit: ${SOURCE_COMMIT}
License: Creative Commons Attribution 4.0 International (CC BY 4.0)
License URL: https://creativecommons.org/licenses/by/4.0/
Upstream license text: selfhst-LICENSE.txt

Coffer includes ${EXPECTED_SVG_COUNT} SVG files from ${EXPECTED_FAMILY_COUNT} icon families.
Names and logos remain the property or trademarks of their respective owners. Their inclusion does not imply affiliation with or endorsement of Coffer.

Coffer modification:
- Upstream filenames are prefixed with "selfhst-" to prevent collisions with Coffer's existing icon catalog.
- selfhst-paypal-light.svg: removed one empty self-closing Adobe Illustrator foreignObject element during passive-SVG sanitization. No visible artwork was changed.

All other SVG files are copied byte-for-byte from the pinned upstream commit.
`;
}

async function writeInBatches(entries) {
  const batchSize = 64;
  for (let index = 0; index < entries.length; index += batchSize) {
    const batch = entries.slice(index, index + batchSize);
    await Promise.all(
      batch.map(({ buffer, filename }) => writeFile(join(brandsRoot, filename), buffer)),
    );
  }
}

async function pruneStaleIntegratedAssets(desiredAssets) {
  const entries = await readdir(brandsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.isFile() &&
      entry.name.startsWith(OUTPUT_PREFIX) &&
      entry.name.endsWith(".svg") &&
      !desiredAssets.has(entry.name)
    ) {
      await rm(join(brandsRoot, entry.name), { force: true });
    }
  }
}

async function removeLegacyLayout() {
  await Promise.all([
    rm(legacyPublicCatalogPath, { force: true }),
    rm(legacyOutputRoot, { force: true, recursive: true }),
  ]);
}

async function main() {
  if (process.argv.length !== 3) {
    fail("Usage: node scripts/import-selfhst-icons.mjs <path-to-selfhst-icons-repository>");
  }

  const sourceRoot = resolve(process.argv[2]);
  const sourceSvgRoot = resolve(sourceRoot, "svg");
  if (relative(sourceRoot, sourceSvgRoot).startsWith("..")) fail("Invalid source SVG path.");
  if (
    dirname(catalogOutputPath) !== scriptDirectory ||
    dirname(legacyPublicCatalogPath) !== brandsRoot ||
    dirname(licenseOutputPath) !== brandsRoot ||
    dirname(attributionOutputPath) !== brandsRoot ||
    dirname(legacyOutputRoot) !== brandsRoot
  ) {
    fail("Refusing to write outside public/brands.");
  }

  const head = runGit(sourceRoot, ["rev-parse", "HEAD"]);
  if (head !== SOURCE_COMMIT) {
    fail(`Expected selfhst/icons commit ${SOURCE_COMMIT}, found ${head}.`);
  }
  const dirty = runGit(sourceRoot, [
    "status",
    "--porcelain",
    "--untracked-files=no",
    "--",
    "LICENSE",
    "index.json",
    "svg",
  ]);
  if (dirty) fail(`The pinned upstream inputs have local changes:\n${dirty}`);

  const trackedSvgPaths = runGit(sourceRoot, [
    "ls-tree",
    "-r",
    "--name-only",
    SOURCE_COMMIT,
    "--",
    "svg",
  ])
    .split(/\r?\n/)
    .filter(Boolean);
  if (
    trackedSvgPaths.length !== EXPECTED_SVG_COUNT ||
    trackedSvgPaths.some((repositoryPath) => !/^svg\/[a-z0-9][a-z0-9-]*\.svg$/.test(repositoryPath))
  ) {
    fail(`Pinned commit does not contain the expected ${EXPECTED_SVG_COUNT} flat SVG files.`);
  }

  const sourceEntries = await readdir(sourceSvgRoot, { withFileTypes: true });
  const svgFilenames = sourceEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".svg"))
    .map((entry) => entry.name)
    .sort(compareOrdinal);
  const trackedFilenames = trackedSvgPaths.map((repositoryPath) => repositoryPath.slice(4)).sort(compareOrdinal);
  if (
    svgFilenames.length !== EXPECTED_SVG_COUNT ||
    svgFilenames.some((filename, index) => filename !== trackedFilenames[index])
  ) {
    fail("The checked-out SVG inventory does not match the pinned commit.");
  }

  const indexBuffer = readGitBlob(sourceRoot, "index.json");
  let upstreamIndex;
  try {
    upstreamIndex = JSON.parse(decodeUtf8(indexBuffer, "index.json"));
  } catch (error) {
    fail(`Could not parse upstream index.json: ${error.message}`);
  }
  const catalog = buildCatalog(svgFilenames, upstreamIndex);

  let modifiedCount = 0;
  const prepared = [];
  const contentHash = createHash("sha256");
  for (const filename of svgFilenames) {
    const sourceBuffer = await readFile(join(sourceSvgRoot, filename));
    const source = decodeUtf8(sourceBuffer, filename);
    const sanitized = sanitizeSvg(filename, source);
    validatePassiveSvg(sanitized.source, filename);
    const outputBuffer = sanitized.modified ? Buffer.from(sanitized.source, "utf8") : sourceBuffer;
    if (sanitized.modified) modifiedCount += 1;
    const outputFilename = `${OUTPUT_PREFIX}${filename}`;
    prepared.push({ buffer: outputBuffer, filename: outputFilename });
    contentHash.update(outputFilename, "utf8");
    contentHash.update("\0", "utf8");
    contentHash.update(outputBuffer);
  }
  if (modifiedCount !== 1) fail(`Expected one sanitized SVG, found ${modifiedCount}.`);

  await mkdir(brandsRoot, { recursive: true });
  await writeInBatches(prepared);
  await pruneStaleIntegratedAssets(new Set(prepared.map(({ filename }) => filename)));
  await writeFile(licenseOutputPath, readGitBlob(sourceRoot, "LICENSE"));
  await writeFile(attributionOutputPath, attributionText(), "utf8");
  await writeFile(catalogOutputPath, `${JSON.stringify(catalog)}\n`, "utf8");
  await removeLegacyLayout();

  const outputEntries = await readdir(brandsRoot, { withFileTypes: true });
  const outputSvgCount = outputEntries.filter(
    (entry) => entry.isFile() && entry.name.startsWith(OUTPUT_PREFIX) && entry.name.endsWith(".svg"),
  ).length;
  if (outputSvgCount !== EXPECTED_SVG_COUNT) {
    fail(`Expected ${EXPECTED_SVG_COUNT} output SVGs, found ${outputSvgCount}.`);
  }

  process.stdout.write(
    [
      `Imported ${EXPECTED_SVG_COUNT} passive SVGs in ${EXPECTED_FAMILY_COUNT} families.`,
      `Pinned source: ${SOURCE_COMMIT}`,
      "Sanitized: selfhst-paypal-light.svg (empty foreignObject removed)",
      `SVG content SHA-256: ${contentHash.digest("hex")}`,
      `Output: ${relative(projectRoot, brandsRoot).replaceAll("\\", "/")}/${OUTPUT_PREFIX}*.svg`,
    ].join("\n") + "\n",
  );
}

await main();
