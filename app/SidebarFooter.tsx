"use client";

import { useEffect, useRef, useState } from "react";
import {
  COFFER_VERSION,
  COFFER_VERSION_NUMBER,
  compareStableVersions,
  normalizeStableVersion,
} from "../lib/version";

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1_000;
const RELEASE_PAGE_PREFIX = "https://github.com/caglaryalcin/Coffer/releases/tag/";
const FIREFOX_EXTENSION_URL = "https://github.com/caglaryalcin/coffer-extension/releases/latest";

type SidebarFooterProps = {
  onOpenAbout: () => void;
};

type AvailableUpdate = {
  version: string;
  url: string;
};

export default function SidebarFooter({ onOpenAbout }: SidebarFooterProps) {
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const lastCheckedAtRef = useRef(0);

  useEffect(() => {
    let active = true;
    let requestController: AbortController | null = null;

    const checkForUpdate = async () => {
      if (requestController) return;
      const controller = new AbortController();
      requestController = controller;
      lastCheckedAtRef.current = Date.now();
      try {
        const response = await fetch("/api/update-check", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (!active || !isRecord(payload)) return;

        const latestVersion = normalizeStableVersion(payload.latestVersion);
        const comparison = compareStableVersions(latestVersion, COFFER_VERSION_NUMBER);
        if (!latestVersion || comparison === null) return;
        if (comparison <= 0) {
          setAvailableUpdate(null);
          return;
        }

        setAvailableUpdate({
          version: latestVersion,
          url: `${RELEASE_PAGE_PREFIX}v${latestVersion}`,
        });
      } catch {
        // Keep a previously verified update visible if a later refresh fails.
      } finally {
        if (requestController === controller) requestController = null;
      }
    };

    const initialCheck = window.setTimeout(() => void checkForUpdate(), 1_000);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void checkForUpdate();
    }, UPDATE_CHECK_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastCheckedAtRef.current >= UPDATE_CHECK_INTERVAL_MS
      ) {
        void checkForUpdate();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      window.clearTimeout(initialCheck);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      requestController?.abort();
    };
  }, []);

  return (
    <footer className="sidebar-footer">
      {availableUpdate ? (
        <a
          className="sidebar-footer-version sidebar-footer-update"
          href={availableUpdate.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Coffer version ${availableUpdate.version} is available. Open release notes in a new tab`}
          title={`v${availableUpdate.version} available!`}
        >v{availableUpdate.version} available!</a>
      ) : (
        <span className="sidebar-footer-version" aria-label={`Coffer version ${COFFER_VERSION_NUMBER}`}>{COFFER_VERSION}</span>
      )}
      <nav className="sidebar-footer-links" aria-label="Coffer links">
        <a
          className="sidebar-footer-link"
          href={FIREFOX_EXTENSION_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Get the Firefox extension in a new tab"
          title="Firefox extension"
        ><span className="sidebar-footer-firefox-icon" aria-hidden="true" /></a>
        <a
          className="sidebar-footer-link"
          href="https://github.com/caglaryalcin/Coffer"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open the Coffer repository on GitHub in a new tab"
          title="GitHub repository"
        ><span className="sidebar-footer-github-icon" aria-hidden="true" /></a>
        <button
          type="button"
          className="sidebar-footer-link"
          aria-label="Open About settings"
          title="About Coffer"
          onClick={onOpenAbout}
        ><span className="sidebar-footer-info-icon" aria-hidden="true">i</span></button>
        <a
          className="sidebar-footer-link"
          href="https://github.com/caglaryalcin/Coffer/issues/new"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open a new Coffer issue on GitHub in a new tab"
          title="Help and issues"
        ><span className="sidebar-footer-help-icon" aria-hidden="true">?</span></a>
      </nav>
    </footer>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
