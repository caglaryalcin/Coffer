const MINUTE_MS = 60_000;

/**
 * Returns the time left before an inactivity lock, or null when auto-lock is
 * disabled. The caller supplies a monotonic timestamp such as performance.now().
 */
export function remainingAutoLockMs(
  lastActivityAtMs: number,
  nowMs: number,
  autoLockMinutes: number,
): number | null {
  if (!Number.isFinite(autoLockMinutes) || autoLockMinutes <= 0) return null;

  const durationMs = autoLockMinutes * MINUTE_MS;
  const elapsedMs = Math.max(0, nowMs - lastActivityAtMs);
  return Math.max(0, durationMs - elapsedMs);
}
