export const ACCOUNT_LOGO_ACCEPT = "image/png,image/jpeg,image/webp";
export const ACCOUNT_LOGO_INPUT_MAX_BYTES = 5 * 1024 * 1024;
export const ACCOUNT_LOGO_OUTPUT_MAX_BYTES = 96 * 1024;
export const ACCOUNT_LOGO_SIZE = 128;

const ACCOUNT_LOGO_MAX_EDGE = 8_192;
const ACCOUNT_LOGO_MAX_PIXELS = 32_000_000;
const SUPPORTED_ACCOUNT_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

type AccountLogoFile = Pick<File, "size" | "type">;

export type ContainRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function validateAccountLogoFile(file: AccountLogoFile): string | null {
  if (!SUPPORTED_ACCOUNT_LOGO_TYPES.has(file.type.toLowerCase())) {
    return "Choose a PNG, JPEG, or WebP image.";
  }
  if (file.size <= 0) return "The selected logo is empty.";
  if (file.size > ACCOUNT_LOGO_INPUT_MAX_BYTES) {
    return "Choose a logo smaller than 5 MB.";
  }
  return null;
}

export function calculateContainRect(
  sourceWidth: number,
  sourceHeight: number,
  targetSize = ACCOUNT_LOGO_SIZE,
): ContainRect {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("The selected logo has invalid dimensions.");
  }
  if (!Number.isFinite(targetSize) || targetSize <= 0) {
    throw new Error("The logo canvas size is invalid.");
  }

  const scale = Math.min(targetSize / sourceWidth, targetSize / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetSize - width) / 2,
    y: (targetSize - height) / 2,
    width,
    height,
  };
}

function decodedDataUrlBytes(encoded: string) {
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.max(0, (encoded.length / 4) * 3 - padding);
}

function isPngSignature(encoded: string) {
  try {
    const prefix = Uint8Array.from(atob(encoded.slice(0, 12)), (character) => character.charCodeAt(0));
    return PNG_SIGNATURE.every((byte, index) => prefix[index] === byte);
  } catch {
    return false;
  }
}

function validateProcessedPng(dataUrl: string) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]*={0,2})$/u.exec(dataUrl);
  if (!match || !CANONICAL_BASE64.test(match[1]) || !isPngSignature(match[1])) {
    throw new Error("The selected logo could not be converted to PNG.");
  }
  if (decodedDataUrlBytes(match[1]) > ACCOUNT_LOGO_OUTPUT_MAX_BYTES) {
    throw new Error("The processed logo is too large. Try a simpler image.");
  }
  return dataUrl;
}

function validateDecodedDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("The selected logo has invalid dimensions.");
  }
  if (width > ACCOUNT_LOGO_MAX_EDGE || height > ACCOUNT_LOGO_MAX_EDGE || width * height > ACCOUNT_LOGO_MAX_PIXELS) {
    throw new Error("Choose a logo no larger than 8192 px per side or 32 megapixels.");
  }
}

export async function prepareAccountLogo(file: File): Promise<string> {
  const validationError = validateAccountLogoFile(file);
  if (validationError) throw new Error(validationError);

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("The selected logo could not be read.");
  }

  try {
    validateDecodedDimensions(bitmap.width, bitmap.height);

    const canvas = document.createElement("canvas");
    canvas.width = ACCOUNT_LOGO_SIZE;
    canvas.height = ACCOUNT_LOGO_SIZE;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("The selected logo could not be processed.");

    context.clearRect(0, 0, ACCOUNT_LOGO_SIZE, ACCOUNT_LOGO_SIZE);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const rect = calculateContainRect(bitmap.width, bitmap.height);
    try {
      context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
    } catch {
      throw new Error("The selected logo could not be processed.");
    }

    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL("image/png");
    } catch {
      throw new Error("The selected logo could not be converted to PNG.");
    }
    return validateProcessedPng(dataUrl);
  } finally {
    bitmap.close();
  }
}
