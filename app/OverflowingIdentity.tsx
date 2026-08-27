"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

const OVERFLOW_TOLERANCE_PX = 1;
const DEFAULT_SPEED_PX_PER_SECOND = 28;
const MIN_DURATION_SECONDS = 4;
const MAX_DURATION_SECONDS = 18;

export type OverflowingIdentityProps = {
  text: string;
  as?: "p" | "span";
  className?: string;
  pixelsPerSecond?: number;
};

export type HorizontalOverflowMetrics = {
  overflowing: boolean;
  distance: number;
  duration: number;
};

type OverflowStyle = CSSProperties & {
  "--identity-overflow-distance"?: string;
  "--identity-overflow-duration"?: string;
};

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function horizontalOverflowMetrics(
  viewportWidth: number,
  contentWidth: number,
  pixelsPerSecond = DEFAULT_SPEED_PX_PER_SECOND,
): HorizontalOverflowMetrics {
  const distance = finiteNonNegative(contentWidth) - finiteNonNegative(viewportWidth);

  if (distance <= OVERFLOW_TOLERANCE_PX) {
    return { overflowing: false, distance: 0, duration: 0 };
  }

  const roundedDistance = Math.ceil(distance);
  const speed = Math.max(1, finiteNonNegative(pixelsPerSecond));
  const duration = Math.min(
    MAX_DURATION_SECONDS,
    Math.max(MIN_DURATION_SECONDS, roundedDistance / speed),
  );

  return {
    overflowing: true,
    distance: roundedDistance,
    duration,
  };
}

export default function OverflowingIdentity({
  text,
  as = "p",
  className,
  pixelsPerSecond = DEFAULT_SPEED_PX_PER_SECOND,
}: OverflowingIdentityProps) {
  const viewportRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLSpanElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [metrics, setMetrics] = useState<HorizontalOverflowMetrics>({
    overflowing: false,
    distance: 0,
    duration: 0,
  });

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    const viewportWidth = viewport.clientWidth || viewport.getBoundingClientRect().width;
    const contentWidth = Math.max(track.scrollWidth, track.getBoundingClientRect().width);
    const next = horizontalOverflowMetrics(viewportWidth, contentWidth, pixelsPerSecond);

    setMetrics((current) => (
      current.overflowing === next.overflowing
      && current.distance === next.distance
      && current.duration === next.duration
        ? current
        : next
    ));
  }, [pixelsPerSecond]);

  const scheduleMeasure = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    let active = true;
    let resizeObserver: ResizeObserver | null = null;

    scheduleMeasure();

    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(scheduleMeasure);
      resizeObserver.observe(viewport);
      resizeObserver.observe(track);
    } else {
      window.addEventListener("resize", scheduleMeasure);
    }

    const fontSet = document.fonts;
    void fontSet?.ready.then(() => {
      if (active) scheduleMeasure();
    });
    fontSet?.addEventListener("loadingdone", scheduleMeasure);

    return () => {
      active = false;
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      fontSet?.removeEventListener("loadingdone", scheduleMeasure);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [scheduleMeasure, text]);

  const style: OverflowStyle | undefined = metrics.overflowing
    ? {
        "--identity-overflow-distance": `${metrics.distance}px`,
        "--identity-overflow-duration": `${metrics.duration}s`,
      }
    : undefined;
  const classes = [
    "overflowing-identity",
    metrics.overflowing ? "is-overflowing" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  if (as === "span") {
    return (
      <span
        ref={viewportRef}
        className={classes}
        data-overflowing={metrics.overflowing ? "true" : "false"}
        data-i18n-ignore
        style={style}
        title={metrics.overflowing ? text : undefined}
      >
        <span ref={trackRef} className="overflowing-identity-track">{text}</span>
      </span>
    );
  }

  return (
    <p
      ref={viewportRef}
      className={classes}
      data-overflowing={metrics.overflowing ? "true" : "false"}
      data-i18n-ignore
      style={style}
      title={metrics.overflowing ? text : undefined}
    >
      <span ref={trackRef} className="overflowing-identity-track">{text}</span>
    </p>
  );
}
