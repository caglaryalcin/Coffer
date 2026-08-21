"use client";

import { type ChangeEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import jsQR from "jsqr";

type DetectedBarcode = {
  rawValue?: string;
};

type NativeBarcodeDetector = {
  detect(source: CanvasImageSource): Promise<readonly DetectedBarcode[]>;
};

type NativeBarcodeDetectorConstructor = new (options?: {
  formats?: string[];
}) => NativeBarcodeDetector;

type ScannerSupport = "checking" | "native" | "fallback";
type CameraPhase = "idle" | "starting" | "scanning";
type CameraStartSource = "automatic" | "manual";
type CameraStartStage = "access" | "playback";

type DecodeResult = {
  uri: string | null;
  qrFound: boolean;
};

type LoadedImage = {
  source: ImageBitmap | HTMLImageElement;
  width: number;
  height: number;
  close: () => void;
};

type ImageFormat = "png" | "jpeg" | "webp";

type ImageDimensions = {
  format: ImageFormat;
  width: number;
  height: number;
};

export type QrScannerProps = {
  onDetected: (uri: string) => void;
  onFallback: () => void;
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_QR_VALUE_LENGTH = 8_192;
const MAX_CAMERA_DECODE_EDGE = 1_280;
const MAX_IMAGE_DECODE_EDGE = 2_048;
const MAX_SOURCE_IMAGE_EDGE = 8_192;
const MAX_SOURCE_IMAGE_PIXELS = 32_000_000;
const MAX_IMAGE_HEADER_BYTES = 1024 * 1024;
const SCAN_INTERVAL_MS = 250;
const SUPPORTED_QR_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const IMAGE_FORMAT_BY_MIME = new Map<string, ImageFormat>([
  ["image/png", "png"],
  ["image/jpeg", "jpeg"],
  ["image/webp", "webp"],
]);

function matchesAscii(bytes: Uint8Array, offset: number, value: string) {
  if (offset + value.length > bytes.length) return false;
  return [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function pngDimensions(bytes: Uint8Array, view: DataView): ImageDimensions | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !signature.every((value, index) => bytes[index] === value)) return null;
  if (view.getUint32(8) !== 13 || !matchesAscii(bytes, 12, "IHDR")) return null;
  return { format: "png", width: view.getUint32(16), height: view.getUint32(20) };
}

function jpegDimensions(bytes: Uint8Array, view: DataView): ImageDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;

  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;

    const marker = bytes[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) return null;

    const segmentLength = view.getUint16(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      if (segmentLength < 8) return null;
      return {
        format: "jpeg",
        width: view.getUint16(offset + 5),
        height: view.getUint16(offset + 3),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array, view: DataView): ImageDimensions | null {
  if (bytes.length < 20 || !matchesAscii(bytes, 0, "RIFF") || !matchesAscii(bytes, 8, "WEBP")) return null;
  const chunkSize = view.getUint32(16, true);

  if (matchesAscii(bytes, 12, "VP8X") && chunkSize >= 10 && bytes.length >= 30) {
    return {
      format: "webp",
      width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
      height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
    };
  }
  if (matchesAscii(bytes, 12, "VP8 ") && chunkSize >= 10 && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return {
      format: "webp",
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  if (matchesAscii(bytes, 12, "VP8L") && chunkSize >= 5 && bytes.length >= 25 && bytes[20] === 0x2f) {
    return {
      format: "webp",
      width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8),
      height: 1 + ((bytes[22] & 0xc0) >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10),
    };
  }
  return null;
}

async function inspectImageDimensions(file: File): Promise<ImageDimensions> {
  const declaredFormat = IMAGE_FORMAT_BY_MIME.get(file.type.toLowerCase());
  if (!declaredFormat) throw new Error("Unsupported image type");

  const header = new Uint8Array(await file.slice(0, MAX_IMAGE_HEADER_BYTES).arrayBuffer());
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const dimensions = pngDimensions(header, view) ?? jpegDimensions(header, view) ?? webpDimensions(header, view);
  if (!dimensions || dimensions.format !== declaredFormat) {
    throw new Error("Unsupported or unreadable image header");
  }
  if (dimensions.width <= 0 || dimensions.height <= 0) throw new Error("Invalid image dimensions");
  return dimensions;
}

function imageDimensionsExceedLimit({ width, height }: ImageDimensions): boolean {
  return width > MAX_SOURCE_IMAGE_EDGE || height > MAX_SOURCE_IMAGE_EDGE || width * height > MAX_SOURCE_IMAGE_PIXELS;
}

function barcodeDetectorConstructor(): NativeBarcodeDetectorConstructor | undefined {
  return (globalThis as typeof globalThis & {
    BarcodeDetector?: NativeBarcodeDetectorConstructor;
  }).BarcodeDetector;
}

export function totpUriFromValues(values: readonly (string | undefined)[]): string | null {
  for (const rawValue of values) {
    const value = rawValue?.trim();
    if (!value || value.length > MAX_QR_VALUE_LENGTH) continue;

    try {
      const parsed = new URL(value);
      if (
        parsed.protocol === "otpauth:" &&
        parsed.hostname === "totp" &&
        parsed.username === "" &&
        parsed.password === "" &&
        parsed.port === ""
      ) {
        return value;
      }
    } catch {
      // Non-URL QR payloads are intentionally ignored.
    }
  }
  return null;
}

function nativeDecodeResult(barcodes: readonly DetectedBarcode[]): DecodeResult {
  return {
    uri: totpUriFromValues(barcodes.map((barcode) => barcode.rawValue)),
    qrFound: barcodes.length > 0,
  };
}

function scaledDimensions(width: number, height: number, maxEdge: number) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function drawScaledImage(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  canvas: HTMLCanvasElement,
  maxEdge: number,
) {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("The image dimensions are invalid");
  }

  const dimensions = scaledDimensions(sourceWidth, sourceHeight, maxEdge);
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas decoding is unavailable");
  context.drawImage(source, 0, 0, dimensions.width, dimensions.height);
  return { ...dimensions, context };
}

function decodeWithJsQr(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  canvas: HTMLCanvasElement,
  maxEdge: number,
): DecodeResult {
  const prepared = drawScaledImage(source, sourceWidth, sourceHeight, canvas, maxEdge);
  const pixels = prepared.context.getImageData(0, 0, prepared.width, prepared.height);
  const code = jsQR(pixels.data, prepared.width, prepared.height, {
    inversionAttempts: "attemptBoth",
  });

  return {
    uri: code ? totpUriFromValues([code.data]) : null,
    qrFound: code !== null,
  };
}

function loadImageElement(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => undefined,
      });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The image could not be decoded"));
    };
    image.src = objectUrl;
  });
}

async function loadImage(file: File): Promise<LoadedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Older browsers sometimes expose createImageBitmap without supporting every image format.
    }
  }
  return loadImageElement(file);
}

export function cameraErrorMessage(
  error: unknown,
  source: CameraStartSource,
  stage: CameraStartStage,
  secureContext = globalThis.isSecureContext,
): string {
  if (!secureContext) {
    return "Camera access requires HTTPS or localhost.";
  }
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      if (stage === "playback") {
        return source === "automatic"
          ? "Your browser blocked automatic camera playback. Select Start camera to begin scanning."
          : "Camera playback was blocked. Select Start camera to try again.";
      }
      return source === "automatic"
        ? "Automatic camera access was blocked. Allow camera access in your browser, then select Start camera."
        : "Camera permission was denied. Allow camera access in your browser settings, then select Start camera to retry.";
    }
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
      return "No suitable camera was found on this device.";
    }
    if (error.name === "NotReadableError" || error.name === "AbortError") {
      return "The camera could not be opened. It may already be in use by another application.";
    }
  }
  return "The camera could not be started. Import a QR image or enter the setup link instead.";
}

export default function QrScanner({ onDetected, onFallback }: QrScannerProps) {
  const imageHelpId = useId();
  const [support, setSupport] = useState<ScannerSupport>("checking");
  const [cameraPhase, setCameraPhase] = useState<CameraPhase>("idle");
  const [imageBusy, setImageBusy] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectorRef = useRef<NativeBarcodeDetector | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const decoderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const scanGenerationRef = useRef(0);
  const imageGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const automaticStartAttemptedRef = useRef(false);
  const streamEndCleanupRef = useRef<(() => void) | null>(null);

  const stopCamera = useCallback(() => {
    scanGenerationRef.current += 1;
    if (scanTimerRef.current !== null) {
      window.clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }

    streamEndCleanupRef.current?.();
    streamEndCleanupRef.current = null;

    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    if (mountedRef.current) setCameraPhase("idle");
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const supportTimer = window.setTimeout(() => {
      const Detector = barcodeDetectorConstructor();
      if (!Detector) {
        setSupport("fallback");
      } else {
        try {
          detectorRef.current = new Detector({ formats: ["qr_code"] });
          setSupport("native");
        } catch {
          setSupport("fallback");
        }
      }
    }, 0);

    return () => {
      window.clearTimeout(supportTimer);
      mountedRef.current = false;
      imageGenerationRef.current += 1;
      detectorRef.current = null;
      if (decoderCanvasRef.current) {
        decoderCanvasRef.current.width = 0;
        decoderCanvasRef.current.height = 0;
        decoderCanvasRef.current = null;
      }
      stopCamera();
    };
  }, [stopCamera]);

  const startCamera = useCallback(async (source: CameraStartSource = "manual") => {
    setError("");
    if (support === "checking") {
      setError("The QR scanner is still getting ready. Try again in a moment.");
      return;
    }
    if (!globalThis.isSecureContext) {
      setError("Camera access requires HTTPS or localhost.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera access is not available in this browser. Import a QR image instead.");
      return;
    }

    stopCamera();
    setCameraPhase("starting");
    const generation = scanGenerationRef.current;
    let startStage: CameraStartStage = "access";

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      if (!mountedRef.current || generation !== scanGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("Camera preview is unavailable");
      }
      streamRef.current = stream;
      video.srcObject = stream;
      startStage = "playback";
      await video.play();
      if (!mountedRef.current || generation !== scanGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const handleStreamEnded = () => {
        if (!mountedRef.current || generation !== scanGenerationRef.current) return;
        stopCamera();
        setError("Camera access ended. Select Start camera to reconnect or import a QR image instead.");
      };
      const videoTracks = stream.getVideoTracks();
      videoTracks.forEach((track) => track.addEventListener("ended", handleStreamEnded, { once: true }));
      streamEndCleanupRef.current = () => {
        videoTracks.forEach((track) => track.removeEventListener("ended", handleStreamEnded));
      };

      setCameraPhase("scanning");
      const scan = async (): Promise<void> => {
        if (!mountedRef.current || generation !== scanGenerationRef.current) return;
        const currentVideo = videoRef.current;
        if (!currentVideo) return;

        if (currentVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          try {
            let result: DecodeResult;
            const detector = detectorRef.current;
            if (detector) {
              try {
                result = nativeDecodeResult(await detector.detect(currentVideo));
              } catch {
                detectorRef.current = null;
                setSupport("fallback");
                const canvas = decoderCanvasRef.current ?? document.createElement("canvas");
                decoderCanvasRef.current = canvas;
                result = decodeWithJsQr(
                  currentVideo,
                  currentVideo.videoWidth,
                  currentVideo.videoHeight,
                  canvas,
                  MAX_CAMERA_DECODE_EDGE,
                );
              }
            } else {
              const canvas = decoderCanvasRef.current ?? document.createElement("canvas");
              decoderCanvasRef.current = canvas;
              result = decodeWithJsQr(
                currentVideo,
                currentVideo.videoWidth,
                currentVideo.videoHeight,
                canvas,
                MAX_CAMERA_DECODE_EDGE,
              );
            }
            if (!mountedRef.current || generation !== scanGenerationRef.current) return;
            if (result.uri) {
              stopCamera();
              setError("");
              onDetected(result.uri);
              return;
            }
            if (result.qrFound) {
              setError("A QR code was found, but it is not a TOTP authenticator setup code.");
            }
          } catch {
            if (!mountedRef.current || generation !== scanGenerationRef.current) return;
            stopCamera();
            setError("The live QR scan stopped unexpectedly. Try the camera again or import a QR image.");
            return;
          }
        }

        if (mountedRef.current && generation === scanGenerationRef.current) {
          scanTimerRef.current = window.setTimeout(() => void scan(), SCAN_INTERVAL_MS);
        }
      };
      scanTimerRef.current = window.setTimeout(() => void scan(), SCAN_INTERVAL_MS);
    } catch (caught) {
      if (!mountedRef.current || generation !== scanGenerationRef.current) return;
      stopCamera();
      setError(cameraErrorMessage(caught, source, startStage));
    }
  }, [onDetected, stopCamera, support]);

  useEffect(() => {
    if (support === "checking" || automaticStartAttemptedRef.current) return;
    automaticStartAttemptedRef.current = true;
    void startCamera("automatic");
  }, [startCamera, support]);

  const decodeImage = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    setError("");
    stopCamera();
    if (support === "checking") {
      setError("The QR scanner is still getting ready. Try again in a moment.");
      return;
    }
    if (file.size === 0) {
      setError("The selected image is empty.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Choose an image smaller than 10 MiB.");
      return;
    }
    if (!SUPPORTED_QR_IMAGE_TYPES.has(file.type.toLowerCase())) {
      setError("Choose a PNG, JPEG, or WebP image containing a QR code.");
      return;
    }

    const generation = imageGenerationRef.current + 1;
    imageGenerationRef.current = generation;
    setImageBusy(true);
    let image: LoadedImage | null = null;
    try {
      const inspectedDimensions = await inspectImageDimensions(file);
      if (!mountedRef.current || generation !== imageGenerationRef.current) return;
      if (imageDimensionsExceedLimit(inspectedDimensions)) {
        setError("Choose a QR image no larger than 8,192 pixels per side and 32 megapixels.");
        return;
      }

      image = await loadImage(file);
      if (!mountedRef.current || generation !== imageGenerationRef.current) return;
      if (imageDimensionsExceedLimit({ format: inspectedDimensions.format, width: image.width, height: image.height })) {
        setError("Choose a QR image no larger than 8,192 pixels per side and 32 megapixels.");
        return;
      }
      let result: DecodeResult;
      const detector = detectorRef.current;
      const canvas = decoderCanvasRef.current ?? document.createElement("canvas");
      decoderCanvasRef.current = canvas;
      if (detector) {
        try {
          drawScaledImage(image.source, image.width, image.height, canvas, MAX_IMAGE_DECODE_EDGE);
          result = nativeDecodeResult(await detector.detect(canvas));
        } catch {
          detectorRef.current = null;
          setSupport("fallback");
          result = decodeWithJsQr(image.source, image.width, image.height, canvas, MAX_IMAGE_DECODE_EDGE);
        }
      } else {
        result = decodeWithJsQr(image.source, image.width, image.height, canvas, MAX_IMAGE_DECODE_EDGE);
      }
      if (!mountedRef.current || generation !== imageGenerationRef.current) return;
      if (!result.uri) {
        setError(result.qrFound
          ? "A QR code was found, but it is not a TOTP authenticator setup code."
          : "No QR code was found in that image. Try a sharper, well-lit image.");
        return;
      }
      setError("");
      onDetected(result.uri);
    } catch {
      if (mountedRef.current && generation === imageGenerationRef.current) {
        setError("The selected image could not be scanned. Try a PNG, JPEG, or WebP image with a clear QR code.");
      }
    } finally {
      image?.close();
      if (mountedRef.current && generation === imageGenerationRef.current) setImageBusy(false);
    }
  }, [onDetected, stopCamera, support]);

  const useFallback = useCallback(() => {
    imageGenerationRef.current += 1;
    setImageBusy(false);
    stopCamera();
    onFallback();
  }, [onFallback, stopCamera]);

  const cameraBusy = cameraPhase === "starting";
  const controlsDisabled = support === "checking" || imageBusy;

  return (
    <section className="qr-scanner" aria-labelledby="qr-scanner-title">
      <div className="qr-scanner-heading">
        <div>
          <h3 id="qr-scanner-title">Scan or import an authenticator QR code</h3>
          <p>Use your camera or import a QR image. Scanning happens only on this device.</p>
        </div>
      </div>

      <div className={`qr-camera-preview ${cameraPhase !== "idle" ? "active" : ""}`}>
        <video
          ref={videoRef}
          aria-label="Live camera preview for QR scanning"
          autoPlay
          muted
          playsInline
          hidden={cameraPhase === "idle"}
        />
        {cameraPhase === "scanning" && <p role="status">Looking for a TOTP setup code…</p>}
        {cameraBusy && <p role="status">Waiting for camera access…</p>}
      </div>

      {error && <p className="qr-scanner-error" role="alert">{error}</p>}
      <p className="visually-hidden" aria-live="polite">
        {imageBusy ? "Scanning the selected image." : cameraPhase === "scanning" ? "Camera scanner active." : ""}
      </p>

      <div className="qr-scanner-actions">
        {cameraPhase === "idle" ? (
          <button type="button" onClick={() => void startCamera("manual")} disabled={controlsDisabled}>
            Start camera
          </button>
        ) : (
          <button type="button" onClick={stopCamera}>
            Stop camera
          </button>
        )}

        <label className={`qr-image-picker ${controlsDisabled ? "disabled" : ""}`} aria-busy={imageBusy}>
          <span>{imageBusy ? "Importing QR code…" : "Import QR code"}</span>
          <input
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            aria-describedby={imageHelpId}
            disabled={controlsDisabled}
            onChange={(event) => void decodeImage(event)}
          />
        </label>

        <small className="qr-image-picker-hint" id={imageHelpId}>PNG, JPEG, or WebP · maximum 10 MiB · processed locally</small>

        <button type="button" className="qr-scanner-fallback" onClick={useFallback}>
          Enter a setup link instead
        </button>
      </div>

      {support === "checking" && <p role="status">Checking QR scanner support…</p>}
    </section>
  );
}
