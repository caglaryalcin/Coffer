"use client";

import { COFFER_VERSION, COFFER_VERSION_NUMBER } from "../../lib/version";

type DemoSidebarFooterProps = {
  onAbout: () => void;
};

export default function DemoSidebarFooter({ onAbout }: DemoSidebarFooterProps) {
  return (
    <footer className="sidebar-footer">
      <span className="sidebar-footer-version" aria-label={`Coffer version ${COFFER_VERSION_NUMBER}`}>
        {COFFER_VERSION}
      </span>
      <nav className="sidebar-footer-links" aria-label="Coffer links">
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
          onClick={onAbout}
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
