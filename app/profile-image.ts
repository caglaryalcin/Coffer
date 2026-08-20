export const PROFILE_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
export const PROFILE_IMAGE_INPUT_MAX_BYTES = 5 * 1024 * 1024;
export const PROFILE_IMAGE_OUTPUT_MAX_BYTES = 512 * 1024;
export const PROFILE_IMAGE_SIZE = 256;

const SUPPORTED_PROFILE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type ProfileImageFile = Pick<File, "size" | "type">;

export function validateProfileImageFile(file: ProfileImageFile): string | null {
  if (!SUPPORTED_PROFILE_IMAGE_TYPES.has(file.type.toLowerCase())) {
    return "Choose a PNG, JPEG, or WebP image.";
  }
  if (file.size <= 0) return "The selected image is empty.";
  if (file.size > PROFILE_IMAGE_INPUT_MAX_BYTES) {
    return "Choose an image smaller than 5 MB.";
  }
  return null;
}

function decodedDataUrlBytes(dataUrl: string) {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
}

function canvasDataUrl(canvas: HTMLCanvasElement) {
  for (const quality of [0.86, 0.74, 0.62]) {
    const webp = canvas.toDataURL("image/webp", quality);
    if (webp.startsWith("data:image/webp;base64,") && decodedDataUrlBytes(webp) <= PROFILE_IMAGE_OUTPUT_MAX_BYTES) {
      return webp;
    }
  }

  const jpeg = canvas.toDataURL("image/jpeg", 0.82);
  if (jpeg.startsWith("data:image/jpeg;base64,") && decodedDataUrlBytes(jpeg) <= PROFILE_IMAGE_OUTPUT_MAX_BYTES) {
    return jpeg;
  }

  throw new Error("The processed profile photo is too large.");
}

export async function prepareProfileImage(file: File) {
  const validationError = validateProfileImageFile(file);
  if (validationError) throw new Error(validationError);

  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error("The selected image could not be read.");

    const canvas = document.createElement("canvas");
    canvas.width = PROFILE_IMAGE_SIZE;
    canvas.height = PROFILE_IMAGE_SIZE;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("The selected image could not be processed.");

    const cropSize = Math.min(bitmap.width, bitmap.height);
    const sourceX = Math.floor((bitmap.width - cropSize) / 2);
    const sourceY = Math.floor((bitmap.height - cropSize) / 2);
    context.fillStyle = "#f2f0eb";
    context.fillRect(0, 0, PROFILE_IMAGE_SIZE, PROFILE_IMAGE_SIZE);
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      cropSize,
      cropSize,
      0,
      0,
      PROFILE_IMAGE_SIZE,
      PROFILE_IMAGE_SIZE,
    );
    return canvasDataUrl(canvas);
  } finally {
    bitmap.close();
  }
}
