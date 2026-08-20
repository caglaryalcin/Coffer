"use client";

import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
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

export type QrScannerProps = {
  onDetected: (uri: string) => void;
  onFallback: () => void;
};

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_QR_VALUE_LENGTH = 8_192;
const MAX_CAMERA_DECODE_EDGE = 1_280;
const MAX_IMAGE_DECODE_EDGE = 2_048;
const SCAN_INTERVAL_MS = 250;

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

function decodeWithJsQr(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  canvas: HTMLCanvasElement,
  maxEdge: number,
): DecodeResult {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    return { uri: null, qrFound: false };
  }

  const dimensions = scaledDimensions(sourceWidth, sourceHeight, maxEdge);
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas decoding is unavailable");

  context.drawImage(source, 0, 0, dimensions.width, dimensions.height);
  const pixels = context.getImageData(0, 0, dimensions.width, dimensions.height);
  const code = jsQR(pixels.data, dimensions.width, dimensions.height, {
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
  return "The camera could not be started. Scan an image or enter the setup link instead.";
}

export default function QrScanner({ onDetected, onFallback }: QrScannerProps) {
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
      setError("Camera access is not available in this browser. Scan an image instead.");
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
        setError("Camera access ended. Select Start camera to reconnect or scan an image instead.");
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
            setError("The live QR scan stopped unexpectedly. Try the camera again or scan an image.");
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

    const generation = imageGenerationRef.current + 1;
    imageGenerationRef.current = generation;
    setImageBusy(true);
    let image: LoadedImage | null = null;
    try {
      image = await loadImage(file);
      if (!mountedRef.current || generation !== imageGenerationRef.current) return;
      let result: DecodeResult;
      const detector = detectorRef.current;
      if (detector) {
        try {
          result = nativeDecodeResult(await detector.detect(image.source));
        } catch {
          detectorRef.current = null;
          setSupport("fallback");
          const canvas = decoderCanvasRef.current ?? document.createElement("canvas");
          decoderCanvasRef.current = canvas;
          result = decodeWithJsQr(image.source, image.width, image.height, canvas, MAX_IMAGE_DECODE_EDGE);
        }
      } else {
        const canvas = decoderCanvasRef.current ?? document.createElement("canvas");
        decoderCanvasRef.current = canvas;
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
        setError("The selected image could not be scanned. Try a PNG or JPEG with a clear QR code.");
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
          <h3 id="qr-scanner-title">Scan an authenticator QR code</h3>
          <p>Use your camera or choose an image. Scanning happens only on this device.</p>
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

        <label className={`qr-image-picker ${controlsDisabled ? "disabled" : ""}`}>
          <span>{imageBusy ? "Scanning image…" : "Scan an image"}</span>
          <input
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/*"
            disabled={controlsDisabled}
            onChange={(event) => void decodeImage(event)}
          />
        </label>

        <button type="button" className="qr-scanner-fallback" onClick={useFallback}>
          Enter a setup link instead
        </button>
      </div>

      {support === "checking" && <p role="status">Checking QR scanner support…</p>}
    </section>
  );
}
