"use client";

import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

type DemoTransferTab = "import" | "export";

const DEMO_IMPORT_SOURCES = [
  {
    id: "coffer",
    title: "Coffer backup",
    description: "Restore accounts, groups, favorites, custom logos, and TOTP settings from a Coffer backup.",
    badge: "Recommended",
    fileHint: ".coffer encrypted or unprotected export",
    passphraseLabel: "Backup passphrase (if used)",
    passphrasePlaceholder: "Available in the full app",
  },
  {
    id: "2fas",
    title: "2fas integrated import",
    description: "Import a .2fas file and review every account before adding it.",
    fileHint: ".2fas mobile backup",
    passphraseLabel: "2fas backup password (if used)",
    passphrasePlaceholder: "Available in the full app",
  },
  {
    id: "2fauth",
    title: "2fauth integrated import",
    description: "Import a schema 1 JSON file from 2FAuth and review every account before adding it.",
    fileHint: "2FAuth schema 1 JSON export",
  },
  {
    id: "otpauth",
    title: "OTPAuth link list",
    description: "Import one otpauth:// link per line for an interoperable transfer.",
    fileHint: "Plain-text OTPAuth link list",
  },
] as const;

export default function DemoTransferCenter() {
  const tabId = useId();
  const [tab, setTab] = useState<DemoTransferTab>("import");
  const [selectedSource, setSelectedSource] = useState<(typeof DEMO_IMPORT_SOURCES)[number]["id"]>("coffer");
  const importTabRef = useRef<HTMLButtonElement>(null);
  const exportTabRef = useRef<HTMLButtonElement>(null);
  const activeSource = DEMO_IMPORT_SOURCES.find((source) => source.id === selectedSource) ?? DEMO_IMPORT_SOURCES[0];

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    let nextTab: DemoTransferTab | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      nextTab = tab === "import" ? "export" : "import";
    } else if (event.key === "Home") {
      nextTab = "import";
    } else if (event.key === "End") {
      nextTab = "export";
    }
    if (!nextTab) return;
    event.preventDefault();
    setTab(nextTab);
    (nextTab === "import" ? importTabRef : exportTabRef).current?.focus();
  };

  const preventFileDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "none";
  };

  return (
    <section className="transfer-center" aria-label="Demo data and backup">
      <div className="transfer-tabs" role="tablist" aria-label="Demo transfer direction">
        <button
          ref={importTabRef}
          type="button"
          role="tab"
          id={`${tabId}-import-tab`}
          aria-controls={`${tabId}-import-panel`}
          aria-selected={tab === "import"}
          tabIndex={tab === "import" ? 0 : -1}
          className={tab === "import" ? "active" : ""}
          onClick={() => setTab("import")}
          onKeyDown={handleTabKeyDown}
        >Import</button>
        <button
          ref={exportTabRef}
          type="button"
          role="tab"
          id={`${tabId}-export-tab`}
          aria-controls={`${tabId}-export-panel`}
          aria-selected={tab === "export"}
          tabIndex={tab === "export" ? 0 : -1}
          className={tab === "export" ? "active" : ""}
          onClick={() => setTab("export")}
          onKeyDown={handleTabKeyDown}
        >Export</button>
      </div>

      {tab === "import" ? (
        <div className="transfer-panel" role="tabpanel" id={`${tabId}-import-panel`} aria-labelledby={`${tabId}-import-tab`}>
          <div className="source-grid">
            {DEMO_IMPORT_SOURCES.map((source) => (
              <button
                type="button"
                className={`source-card ${selectedSource === source.id ? "active" : ""}`}
                key={source.id}
                aria-pressed={selectedSource === source.id}
                onClick={() => setSelectedSource(source.id)}
                title={`Preview ${source.title}`}
              >
                <span className={`source-icon ${source.id}`} aria-hidden="true" />
                <span>
                  <strong>{source.title}</strong>
                  {"badge" in source && source.badge && <em>{source.badge}</em>}
                  <small>{source.description}</small>
                </span>
                <i aria-hidden="true">{selectedSource === source.id ? "✓" : ""}</i>
              </button>
            ))}
          </div>

          <div className="transfer-form">
            <div
              className="file-drop"
              aria-disabled="true"
              onDragEnter={preventFileDrop}
              onDragOver={preventFileDrop}
              onDrop={preventFileDrop}
            >
              <span className="file-icon" aria-hidden="true" />
              <div>
                <strong>{activeSource.title} file</strong>
                <small>{activeSource.fileHint} — preview only</small>
              </div>
              <button type="button" disabled aria-disabled="true">Choose file</button>
            </div>
            {"passphraseLabel" in activeSource ? (
              <label>
                <span>{activeSource.passphraseLabel}</span>
                <input
                  type="password"
                  placeholder={activeSource.passphrasePlaceholder}
                  autoComplete="new-password"
                  disabled
                  aria-disabled="true"
                />
              </label>
            ) : activeSource.id === "otpauth" ? (
              <label>
                <span>OTPAuth links</span>
                <textarea
                  value="otpauth://totp/Demo:sample?secret=JBSWY3DPEHPK3PXP"
                  readOnly
                  aria-readonly="true"
                  rows={3}
                />
                <small>A known public test vector is shown. Secret-bearing input is disabled in this demo.</small>
              </label>
            ) : (
              <div className="demo-transfer-source-note" role="note">
                <strong>No passphrase field</strong>
                <span>2FAuth schema 1 exports are reviewed directly after local JSON parsing in the full app.</span>
              </div>
            )}
          </div>

          <div className="transfer-footer">
            <p><span className="mini-lock" aria-hidden="true" /> Import review is shown here in the full app before anything is added to the encrypted vault.</p>
            <button type="button" className="transfer-primary" disabled aria-disabled="true">
              Review accounts <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="export-stack" role="tabpanel" id={`${tabId}-export-panel`} aria-labelledby={`${tabId}-export-tab`}>
          <section className="export-card recommended">
            <div className="export-card-head">
              <span className="export-icon encrypted" aria-hidden="true" />
              <div>
                <p>RECOMMENDED</p>
                <h2>Coffer backup</h2>
                <span>Create a complete backup containing accounts, groups, favorites, custom logos, and TOTP settings. A passphrase is optional.</span>
              </div>
            </div>
            <div className="export-fields">
              <label>
                <span>Backup passphrase (optional)</span>
                <input type="password" placeholder="Leave blank or use 12+ characters" disabled aria-disabled="true" />
              </label>
              <label>
                <span>Confirm passphrase</span>
                <input type="password" placeholder="Repeat it if used" disabled aria-disabled="true" />
              </label>
            </div>
            <div className="backup-passphrase-important export-passphrase-important" role="note">
              <span className="backup-passphrase-important-title"><span className="backup-passphrase-important-icon" aria-hidden="true">!</span>Important</span>
              <small>Without a passphrase, anyone with the exported file can read its authentication secrets.</small>
            </div>
            <div className="export-card-footer">
              <p>Downloads are disabled in the public demo.</p>
              <button type="button" className="transfer-primary" disabled aria-disabled="true">
                Create unprotected export <span aria-hidden="true">↓</span>
              </button>
            </div>
          </section>

          <section className="export-card interoperable">
            <div className="export-card-head">
              <span className="export-icon twofas" aria-hidden="true" />
              <div>
                <p>2FAS COMPATIBLE</p>
                <h2>2FAS mobile backup</h2>
                <span>Create a password-protected .2fas file for the mobile app. Archived accounts and custom logos are excluded.</span>
              </div>
            </div>
            <div className="export-fields">
              <label>
                <span>2FAS backup passphrase</span>
                <input type="password" placeholder="At least 12 characters" disabled aria-disabled="true" />
              </label>
              <label>
                <span>Confirm passphrase</span>
                <input type="password" placeholder="Repeat your passphrase" disabled aria-disabled="true" />
              </label>
            </div>
            <div className="export-card-footer">
              <p>Use printable ASCII characters for iOS and Android compatibility.</p>
              <button type="button" className="transfer-primary" disabled aria-disabled="true">
                Create 2fas export <span aria-hidden="true">↓</span>
              </button>
            </div>
          </section>

          <section className="export-card danger open">
            <div className="danger-toggle" aria-disabled="true">
              <span className="export-icon readable" aria-hidden="true" />
              <span><em>Dangerous</em><strong>Plaintext export</strong><small>Export interoperable files containing readable secrets.</small></span>
              <i aria-hidden="true">−</i>
            </div>
            <div className="danger-body">
              <div className="danger-warning">
                <strong>Your authentication secrets would be readable without a password.</strong>
                <span>Anyone with this file could generate your verification codes.</span>
              </div>
              <div className="danger-actions">
                <button type="button" disabled aria-disabled="true">Export unencrypted file</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
