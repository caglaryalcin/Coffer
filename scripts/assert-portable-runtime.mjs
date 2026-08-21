import {
  closeSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
} from "node:fs";
import { join, resolve } from "node:path";

const roots = process.argv.slice(2).map((entry) => resolve(entry));

if (roots.length === 0) {
  throw new Error("Provide at least one runtime path to inspect.");
}

const nativeExtension = /(?:\.node|\.so(?:\.[^/\\]+)*|\.dylib|\.dll|\.exe)$/i;
const nativeMagic = [
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0x4d, 0x5a], // PE/COFF
  [0xfe, 0xed, 0xfa, 0xce], // Mach-O 32-bit
  [0xfe, 0xed, 0xfa, 0xcf], // Mach-O 64-bit
  [0xce, 0xfa, 0xed, 0xfe], // Mach-O 32-bit, reversed
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O 64-bit, reversed
  [0xca, 0xfe, 0xba, 0xbe], // Universal Mach-O
  [0xbe, 0xba, 0xfe, 0xca], // Universal Mach-O, reversed
];

let inspectedFiles = 0;

function hasMagicPrefix(buffer, magic) {
  return magic.every((byte, index) => buffer[index] === byte);
}

function inspectFile(path) {
  if (nativeExtension.test(path)) {
    throw new Error(`Architecture-specific runtime artifact: ${path}`);
  }

  const header = Buffer.allocUnsafe(4);
  const descriptor = openSync(path, "r");
  let bytesRead;

  try {
    bytesRead = readSync(descriptor, header, 0, header.length, 0);
  } finally {
    closeSync(descriptor);
  }

  inspectedFiles += 1;
  const prefix = header.subarray(0, bytesRead);

  if (nativeMagic.some((magic) => hasMagicPrefix(prefix, magic))) {
    throw new Error(`Architecture-specific runtime artifact: ${path}`);
  }
}

function inspectPath(path) {
  const metadata = lstatSync(path);

  if (metadata.isSymbolicLink()) {
    throw new Error(`Runtime symlinks are not portable: ${path}`);
  }

  if (metadata.isFile()) {
    inspectFile(path);
    return;
  }

  if (!metadata.isDirectory()) {
    throw new Error(`Unsupported runtime filesystem entry: ${path}`);
  }

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    inspectPath(join(path, entry.name));
  }
}

for (const root of roots) {
  inspectPath(root);
}

console.log(`Verified ${inspectedFiles} portable runtime files.`);
