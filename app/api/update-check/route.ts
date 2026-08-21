import {
  COFFER_VERSION_NUMBER,
  compareStableVersions,
  normalizeStableVersion,
} from "@/lib/version";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LATEST_RELEASE_ENDPOINT = "https://api.github.com/repos/caglaryalcin/Coffer/releases/latest";
const RELEASE_PAGE_PREFIX = "https://github.com/caglaryalcin/Coffer/releases/tag/";
const REQUEST_TIMEOUT_MS = 4_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const SUCCESS_TTL_MS = 60 * 60 * 1_000;
const FAILURE_TTL_MS = 15 * 60 * 1_000;
const STALE_TTL_MS = 24 * 60 * 60 * 1_000;

type UpdateCheckResult = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  checkedAt: string;
  stale?: true;
};

type CachedResult = {
  value: UpdateCheckResult;
  expiresAt: number;
};

type SuccessfulResult = CachedResult & {
  staleUntil: number;
};

let cachedResult: CachedResult | null = null;
let lastSuccessfulResult: SuccessfulResult | null = null;
let pendingCheck: Promise<UpdateCheckResult> | null = null;

export async function GET(): Promise<Response> {
  return Response.json(await updateCheck(), {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function updateCheck(): Promise<UpdateCheckResult> {
  const now = Date.now();
  if (cachedResult && cachedResult.expiresAt > now) return cachedResult.value;
  if (pendingCheck) return pendingCheck;

  const check = refreshUpdateCheck();
  pendingCheck = check;
  try {
    return await check;
  } finally {
    if (pendingCheck === check) pendingCheck = null;
  }
}

async function refreshUpdateCheck(): Promise<UpdateCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(LATEST_RELEASE_ENDPOINT, {
      method: "GET",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "Coffer-update-check (+https://github.com/caglaryalcin/Coffer)",
      },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("The release service did not return a successful response.");

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new Error("The release response is too large.");
    }

    const responseText = await readLimitedText(response, MAX_RESPONSE_BYTES);
    const payload: unknown = JSON.parse(responseText);
    if (!isRecord(payload)) throw new Error("The release response is invalid.");

    const latestVersion = normalizeStableVersion(payload.tag_name);
    const comparison = compareStableVersions(latestVersion, COFFER_VERSION_NUMBER);
    if (!latestVersion || comparison === null) throw new Error("The release tag is invalid.");

    const updateAvailable = comparison > 0;
    const completedAt = Date.now();
    const value: UpdateCheckResult = {
      currentVersion: COFFER_VERSION_NUMBER,
      latestVersion,
      updateAvailable,
      releaseUrl: updateAvailable ? `${RELEASE_PAGE_PREFIX}v${latestVersion}` : null,
      checkedAt: new Date(completedAt).toISOString(),
    };
    cachedResult = { value, expiresAt: completedAt + SUCCESS_TTL_MS };
    lastSuccessfulResult = {
      value,
      expiresAt: completedAt + SUCCESS_TTL_MS,
      staleUntil: completedAt + STALE_TTL_MS,
    };
    return value;
  } catch {
    const completedAt = Date.now();
    const previous = lastSuccessfulResult && lastSuccessfulResult.staleUntil > completedAt
      ? { ...lastSuccessfulResult.value, stale: true as const }
      : {
          currentVersion: COFFER_VERSION_NUMBER,
          latestVersion: null,
          updateAvailable: false,
          releaseUrl: null,
          checkedAt: new Date(completedAt).toISOString(),
        };
    cachedResult = { value: previous, expiresAt: completedAt + FAILURE_TTL_MS };
    return previous;
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readLimitedText(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) throw new Error("The release response is empty.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new Error("The release response is too large.");
      }
      chunks.push(value.slice());
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
