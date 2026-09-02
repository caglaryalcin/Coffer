"use client";

import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  createEncryptedBackup,
  createPlainBackup,
  decryptBackup,
  parsePlainBackup,
  projectCofferAccount,
  type CofferAccount,
} from "../lib/backup";
import { parseOtpAuthList, parseTwoFAuthExport, type ImportItem } from "../lib/importers";
import { createTwoFasBackup, parseTwoFasBackup } from "../lib/twofas";
import { createOtpAuthUri } from "../lib/totp";
import type { VaultColor } from "../lib/vault-model";
import ServiceLogo, { isServiceBrandId } from "./ServiceLogo";

type ImportSource = "coffer" | "2fas" | "2fauth" | "otpauth";
type ReviewStatus = "new" | "exact" | "possible" | "invalid";
type ReviewAction = "keep" | "replace" | "skip";

type ReviewItem = ImportItem & {
  status: ReviewStatus;
  action: ReviewAction;
  existingAccountId?: string;
};

export type ImportDecision = {
  account: CofferAccount;
  replaceAccountId?: string;
};

type TransferAccount = CofferAccount & { id: string };

type TransferCenterProps = {
  accounts: readonly TransferAccount[];
  locked: boolean;
  onBack: () => void;
  onImport: (decisions: ImportDecision[]) => void;
  onNotice: (message: string) => void;
};

const sourceCopy: Record<ImportSource, { title: string; description: string; badge?: string }> = {
  coffer: {
    title: "Coffer backup",
    description: "Restore accounts, groups, favorites, and TOTP settings from a Coffer backup, with or without a passphrase.",
    badge: "Recommended",
  },
  "2fas": {
    title: "2fas integrated import",
    description: "Import a .2fas file from 2FAS and review every account before adding it.",
  },
  "2fauth": {
    title: "2fauth integrated import",
    description: "Import a schema 1 JSON file from 2FAuth and review every account before adding it.",
  },
  otpauth: {
    title: "OTPAuth link list",
    description: "Paste or upload one otpauth:// link per line for an interoperable transfer.",
  },
};

const reviewLogoColors = ["ink", "orange", "blue", "violet", "green"] as const satisfies readonly VaultColor[];

export function reviewLogoForService(service: string): { color: VaultColor; fallback: string } {
  const normalized = service.normalize("NFKC").trim().replace(/\s+/gu, " ");
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const initials = words.length > 1
    ? `${Array.from(words[0] ?? "")[0] ?? ""}${Array.from(words[1] ?? "")[0] ?? ""}`
    : Array.from(words[0] ?? "?").slice(0, 2).join("");
  const fallback = Array.from(initials.toLocaleUpperCase("en")).slice(0, 3).join("") || "?";

  let hash = 2_166_136_261;
  for (const character of normalized.toLocaleLowerCase("en")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }

  return {
    color: reviewLogoColors[(hash >>> 0) % reviewLogoColors.length],
    fallback,
  };
}

function normalizeIdentity(value: string) {
  return value.trim().toLocaleLowerCase("en");
}

function isSameIdentity(left: CofferAccount, right: CofferAccount) {
  return normalizeIdentity(left.service) === normalizeIdentity(right.service) && normalizeIdentity(left.identity) === normalizeIdentity(right.identity);
}

function isExactMatch(left: CofferAccount, right: CofferAccount) {
  return isSameIdentity(left, right) &&
    left.secret === right.secret &&
    (left.algorithm ?? "SHA-1") === (right.algorithm ?? "SHA-1") &&
    (left.digits ?? 6) === (right.digits ?? 6) &&
    (left.period ?? 30) === (right.period ?? 30);
}

function downloadText(contents: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.documentElement.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function exportDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function TransferCenter({ accounts, locked, onBack, onImport, onNotice }: TransferCenterProps) {
  const [tab, setTab] = useState<"import" | "export">("import");
  const [source, setSource] = useState<ImportSource>("coffer");
  const [fileName, setFileName] = useState("");
  const [fileText, setFileText] = useState("");
  const [otpLinks, setOtpLinks] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [review, setReview] = useState<ReviewItem[]>([]);
  const [importComplete, setImportComplete] = useState<{ imported: number; skipped: number } | null>(null);
  const [exportPassword, setExportPassword] = useState("");
  const [exportPasswordConfirm, setExportPasswordConfirm] = useState("");
  const [unprotectedBackupConfirm, setUnprotectedBackupConfirm] = useState(false);
  const [twoFasExportPassword, setTwoFasExportPassword] = useState("");
  const [twoFasExportPasswordConfirm, setTwoFasExportPasswordConfirm] = useState("");
  const [plainOpen, setPlainOpen] = useState(false);
  const [plainFormat, setPlainFormat] = useState<"otp" | "json">("otp");
  const [plainAcknowledged, setPlainAcknowledged] = useState(false);
  const [plainConfirm, setPlainConfirm] = useState(false);
  const [replaceConfirm, setReplaceConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<"coffer" | "2fas" | null>(null);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const cofferExportButtonRef = useRef<HTMLButtonElement>(null);
  const unprotectedBackupBackRef = useRef<HTMLButtonElement>(null);
  const restoreCofferExportFocusRef = useRef(false);
  const fileReadRevision = useRef(0);
  const importOperationRevision = useRef(0);

  useEffect(() => {
    if (unprotectedBackupConfirm) {
      unprotectedBackupBackRef.current?.focus();
      return;
    }
    if (restoreCofferExportFocusRef.current) {
      restoreCofferExportFocusRef.current = false;
      cofferExportButtonRef.current?.focus();
    }
  }, [unprotectedBackupConfirm]);

  const summary = useMemo(() => ({
    fresh: review.filter((item) => item.status === "new").length,
    duplicates: review.filter((item) => item.status === "exact").length,
    attention: review.filter((item) => item.status === "possible" || item.status === "invalid").length,
    selected: review.filter((item) => item.account && item.action !== "skip").length,
  }), [review]);
  const portableAccounts = useMemo(() => accounts.map(projectCofferAccount), [accounts]);

  const clearImportInputs = () => {
    fileReadRevision.current += 1;
    importOperationRevision.current += 1;
    setFileName("");
    setFileText("");
    setOtpLinks("");
    setImportPassword("");
    setReview([]);
    setReplaceConfirm(false);
  };

  const setImportSource = (next: ImportSource) => {
    clearImportInputs();
    setSource(next);
    setImportComplete(null);
    setError("");
  };

  const readFile = async (file?: File) => {
    if (!file || busy) return;
    const revision = fileReadRevision.current + 1;
    fileReadRevision.current = revision;
    importOperationRevision.current += 1;
    setError("");
    setFileName("");
    setFileText("");
    setOtpLinks("");
    setImportPassword("");
    if (file.size > 5 * 1024 * 1024) {
      setError("This file is larger than the 5 MiB import limit.");
      return;
    }
    try {
      const contents = await file.text();
      if (revision !== fileReadRevision.current) return;
      setFileName(file.name);
      setFileText(contents);
    } catch {
      if (revision !== fileReadRevision.current) return;
      setError("We could not read this file. It may be damaged or incomplete.");
    }
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    void readFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void readFile(event.dataTransfer.files?.[0]);
  };

  const createReview = (items: ImportItem[]) => {
    if (items.length === 0) throw new Error("No accounts were found in this file.");
    const staged: CofferAccount[] = [];
    const next = items.map((item): ReviewItem => {
      if (!item.account || item.issue) return { ...item, status: "invalid", action: "skip" };
      const account = item.account;
      const exactExisting = accounts.some((existing) => isExactMatch(existing, account));
      const exactStaged = staged.some((existing) => isExactMatch(existing, account));
      const identityMatches = accounts.filter((existing) => isSameIdentity(existing, account));
      const stagedIdentityMatch = staged.some((existing) => isSameIdentity(existing, account));
      staged.push(account);
      if (exactExisting || exactStaged) return { ...item, status: "exact", action: "skip" };
      if (identityMatches.length > 0 || stagedIdentityMatch) {
        return {
          ...item,
          status: "possible",
          action: "skip",
          existingAccountId: identityMatches.length === 1 && !stagedIdentityMatch ? identityMatches[0].id : undefined,
        };
      }
      return { ...item, status: "new", action: "keep" };
    });
    setReplaceConfirm(false);
    setReview(next);
  };

  const prepareImport = async () => {
    const operation = importOperationRevision.current + 1;
    importOperationRevision.current = operation;
    setError("");
    setImportComplete(null);
    setBusy(true);
    try {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (source === "otpauth") {
        const input = otpLinks.trim() || fileText;
        if (!input) throw new Error("Paste OTPAuth links or choose a file to continue.");
        if (operation !== importOperationRevision.current) return;
        createReview(parseOtpAuthList(input).items);
      } else if (source === "2fas") {
        if (!fileText) throw new Error("Choose a 2FAS file to continue.");
        const restored = await parseTwoFasBackup(fileText, importPassword || undefined);
        if (operation !== importOperationRevision.current) return;
        createReview(restored.items);
      } else if (source === "2fauth") {
        if (!fileText) throw new Error("Choose a 2FAuth JSON file to continue.");
        if (operation !== importOperationRevision.current) return;
        createReview(parseTwoFAuthExport(fileText).items);
      } else {
        if (!fileText) throw new Error("Choose a Coffer backup to continue.");
        let parsedHeader: { kind?: string } = {};
        try { parsedHeader = JSON.parse(fileText) as { kind?: string }; } catch { throw new Error("This does not look like a Coffer backup."); }
        const restored = parsedHeader.kind === "encrypted"
          ? await decryptBackup(fileText, importPassword)
          : parsePlainBackup(fileText);
        if (operation !== importOperationRevision.current) return;
        createReview(restored.map((account, index) => ({ key: `coffer-${index}`, label: `${account.service} — ${account.identity}`, account })));
      }
    } catch (caught) {
      if (operation !== importOperationRevision.current) return;
      setError(caught instanceof Error ? caught.message : "Import failed. No changes were made.");
    } finally {
      if (operation === importOperationRevision.current) {
        if (source === "coffer" || source === "2fas") setImportPassword("");
        setBusy(false);
      }
    }
  };

  const updateAction = (key: string, action: ReviewAction) => {
    setReplaceConfirm(false);
    setReview((current) => current.map((item) => item.key === key ? { ...item, action } : item));
  };

  const commitImport = () => {
    const decisions = review.flatMap((item) => item.account && item.action !== "skip" ? [{
      account: item.account,
      replaceAccountId: item.action === "replace" ? item.existingAccountId : undefined,
    }] : []);
    if (decisions.length === 0) return;
    if (decisions.some((decision) => decision.replaceAccountId) && !replaceConfirm) {
      setReplaceConfirm(true);
      return;
    }
    onImport(decisions);
    const skipped = review.length - decisions.length;
    clearImportInputs();
    setImportComplete({ imported: decisions.length, skipped });
  };

  const handleOtpLinksChange = (value: string) => {
    fileReadRevision.current += 1;
    importOperationRevision.current += 1;
    setOtpLinks(value);
    setFileName("");
    setFileText("");
  };

  const changeTab = (next: "import" | "export") => {
    if (busy) return;
    importOperationRevision.current += 1;
    setTab(next);
    setError("");
    setImportPassword("");
    setExportPassword("");
    setExportPasswordConfirm("");
    setUnprotectedBackupConfirm(false);
    setTwoFasExportPassword("");
    setTwoFasExportPasswordConfirm("");
  };

  const createCofferExport = async (unprotectedConfirmed = false) => {
    setError("");
    if (locked) { setError("Unlock your vault before creating a backup."); return; }
    const passwordProtected = exportPassword.length > 0 || exportPasswordConfirm.length > 0;
    if (passwordProtected && exportPassword !== exportPasswordConfirm) { setError("Passphrases do not match."); return; }
    if (passwordProtected && exportPassword.length < 12) { setError("Use a backup passphrase with at least 12 characters."); return; }
    if (!passwordProtected && !unprotectedConfirmed) {
      restoreCofferExportFocusRef.current = false;
      setUnprotectedBackupConfirm(true);
      return;
    }
    const password = exportPassword;
    setBusy(true);
    setExporting("coffer");
    try {
      const backup = passwordProtected
        ? await createEncryptedBackup(portableAccounts, password)
        : createPlainBackup(portableAccounts);
      downloadText(backup, `coffer-backup-${exportDate()}.coffer`, "application/vnd.coffer.backup+json");
      onNotice(passwordProtected ? "Password-protected Coffer backup downloaded." : "Unprotected Coffer backup downloaded.");
    } catch {
      setError("We could not create the Coffer backup.");
    } finally {
      setExportPassword("");
      setExportPasswordConfirm("");
      restoreCofferExportFocusRef.current = true;
      setUnprotectedBackupConfirm(false);
      setExporting(null);
      setBusy(false);
    }
  };

  const createTwoFasExport = async () => {
    setError("");
    if (locked) { setError("Unlock your vault before creating a backup."); return; }
    if (twoFasExportPassword.length < 12) { setError("Use a 2FAS backup passphrase with at least 12 characters."); return; }
    if (!/^[\x20-\x7e]+$/u.test(twoFasExportPassword)) { setError("Use only printable ASCII characters in the 2FAS passphrase for iOS and Android compatibility."); return; }
    if (twoFasExportPassword !== twoFasExportPasswordConfirm) { setError("2FAS backup passphrases do not match."); return; }
    const password = twoFasExportPassword;
    const activeAccounts = portableAccounts.filter((account) => !account.archived);
    setBusy(true);
    setExporting("2fas");
    try {
      const backup = await createTwoFasBackup(activeAccounts, password);
      downloadText(backup, `coffer-2fas-${exportDate()}.2fas`, "application/json");
      onNotice("Password-protected 2FAS backup downloaded.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not create the 2FAS mobile backup.");
    } finally {
      setTwoFasExportPassword("");
      setTwoFasExportPasswordConfirm("");
      setExporting(null);
      setBusy(false);
    }
  };

  const exportPlaintext = () => {
    setError("");
    if (locked) { setError("Unlock your vault before exporting readable secrets."); return; }
    if (!plainAcknowledged) { setError("Confirm that you understand this file contains unencrypted secrets."); return; }
    const activeAccounts = portableAccounts.filter((account) => !account.archived);
    if (plainFormat === "otp") {
      const links = activeAccounts.map((account) => createOtpAuthUri({
        issuer: account.service,
        account: account.identity,
        secret: account.secret,
        algorithm: account.algorithm ?? "SHA-1",
        digits: account.digits ?? 6,
        period: account.period ?? 30,
      })).join("\n");
      downloadText(`${links}\n`, `coffer-otpauth-${exportDate()}.txt`, "text/plain;charset=utf-8");
    } else {
      downloadText(createPlainBackup(portableAccounts), `coffer-readable-${exportDate()}.json`, "application/json");
    }
    setPlainConfirm(false);
    setPlainAcknowledged(false);
    onNotice("Unencrypted export downloaded.");
  };

  return (
    <section className="transfer-center" aria-label="Data and backup">
      <div className="transfer-tabs" role="tablist" aria-label="Transfer direction">
        <button role="tab" aria-selected={tab === "import"} className={tab === "import" ? "active" : ""} onClick={() => changeTab("import")} disabled={busy}>Import</button>
        <button role="tab" aria-selected={tab === "export"} className={tab === "export" ? "active" : ""} onClick={() => changeTab("export")} disabled={busy}>Export</button>
      </div>

      {error && <div className="transfer-error" role="alert"><span>!</span>{error}</div>}
      <div className="sr-status" aria-live="polite">{busy ? (tab === "import" ? "Reading and checking accounts…" : exporting === "2fas" ? "Creating your 2fas export…" : "Creating your Coffer export…") : ""}</div>

      {tab === "import" ? (
        <div className="transfer-panel">
          {importComplete ? (
            <div className="transfer-success">
              <span className="success-mark">✓</span>
              <p>IMPORT COMPLETE</p>
              <h2>{importComplete.imported} {importComplete.imported === 1 ? "account was" : "accounts were"} imported.</h2>
              <span>{importComplete.skipped} {importComplete.skipped === 1 ? "entry was" : "entries were"} skipped. Imported accounts were encrypted before being saved to your self-hosted vault.</span>
              <div className="transfer-success-actions"><button className="transfer-secondary" onClick={() => { clearImportInputs(); setImportComplete(null); }}>Import another file</button><button className="transfer-primary" onClick={onBack}>View accounts <span>→</span></button></div>
            </div>
          ) : review.length > 0 ? (
            <div className="review-stage">
              <div className="review-head">
                <div><p>REVIEW IMPORT</p><h2>Check before adding</h2></div>
                <button onClick={clearImportInputs}>Start over</button>
              </div>
              <div className="review-summary"><span className="new"><strong>{summary.fresh}</strong> new</span><span><strong>{summary.duplicates}</strong> duplicates</span><span className="attention"><strong>{summary.attention}</strong> need attention</span></div>
              <div className="review-list" role="list">
                {review.map((item) => {
                  const service = item.account?.service ?? item.label;
                  const logo = reviewLogoForService(service);
                  return (
                    <div className="review-item" role="listitem" key={item.key}>
                      <div className="review-account"><ServiceLogo service={service} fallback={logo.fallback} color={logo.color} brandId={isServiceBrandId(item.account?.iconBrand) ? item.account.iconBrand : null} iconDataUrl={item.account?.iconDataUrl ?? null} /><div data-i18n-ignore><strong>{service}</strong><small>{item.account?.identity ?? item.issue}</small></div></div>
                      <span className={`review-status ${item.status}`}>{item.status === "new" ? "New" : item.status === "exact" ? "Exact duplicate" : item.status === "possible" ? "Possible duplicate" : "Invalid"}</span>
                      {item.status === "invalid" || item.status === "exact" ? <span className="review-skip">Skip</span> : (
                        <select aria-label={`Import action for ${item.label}`} value={item.action} onChange={(event) => updateAction(item.key, event.target.value as ReviewAction)}>
                          {item.status === "new" && <option value="keep">Import</option>}
                          <option value="skip">Skip</option>
                          {item.status === "possible" && <><option value="keep">Keep both</option>{item.existingAccountId && <option value="replace">Replace existing</option>}</>}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
              {replaceConfirm ? (
                <div className="replace-confirm" role="alertdialog" aria-labelledby="replace-confirm-title">
                  <div><strong id="replace-confirm-title">Replace selected accounts?</strong><span>The matching accounts will be replaced when the encrypted import is saved to your vault.</span></div>
                  <button onClick={() => setReplaceConfirm(false)}>Go back</button>
                  <button onClick={commitImport}>Replace and import</button>
                </div>
              ) : (
                <div className="review-footer"><p>Secrets stay hidden during review and are encrypted before they are saved.</p><button className="transfer-primary" onClick={commitImport} disabled={summary.selected === 0}>Import {summary.selected} {summary.selected === 1 ? "account" : "accounts"} <span>→</span></button></div>
              )}
            </div>
          ) : (
            <>
              <div className="source-grid">
                {(Object.keys(sourceCopy) as ImportSource[]).map((key) => (
                  <button className={`source-card ${source === key ? "active" : ""}`} key={key} aria-pressed={source === key} onClick={() => setImportSource(key)} disabled={busy}>
                    <span className={`source-icon ${key}`} aria-hidden="true" />
                    <span><strong>{sourceCopy[key].title}</strong>{sourceCopy[key].badge && <em>{sourceCopy[key].badge}</em>}<small>{sourceCopy[key].description}</small></span>
                    <i aria-hidden="true">{source === key ? "✓" : ""}</i>
                  </button>
                ))}
              </div>

              {source === "otpauth" ? (
                <div className="transfer-form">
                  <label><span>OTPAuth links</span><textarea value={otpLinks} onChange={(event) => handleOtpLinksChange(event.target.value)} placeholder="otpauth://totp/Example:user@example.com?secret=…" disabled={busy} /><small>Enter one link per line. Blank lines are ignored.</small></label>
                  <div className="form-divider"><span>or upload a text file</span></div>
                  <div className={`file-drop ${fileName ? "has-file" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
                    <span className="file-icon" /><div><strong data-i18n-ignore={fileName ? true : undefined}>{fileName || "Drop a file here"}</strong><small>{fileName ? "Ready to review" : "Plain UTF-8 text, up to 5 MiB"}</small></div><button onClick={() => fileInput.current?.click()} disabled={busy}>{fileName ? "Change file" : "Choose file"}</button>
                  </div>
                </div>
              ) : (
                <div className="transfer-form">
                  <div className={`file-drop ${fileName ? "has-file" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
                    <span className="file-icon" /><div><strong data-i18n-ignore={fileName ? true : undefined}>{fileName || "Drop a file here"}</strong><small>{fileName ? "Ready to review" : source === "coffer" ? ".coffer or JSON, up to 5 MiB" : source === "2fas" ? ".2fas or JSON, up to 5 MiB" : "2FAuth JSON, up to 5 MiB"}</small></div><button onClick={() => fileInput.current?.click()} disabled={busy}>{fileName ? "Change file" : "Choose file"}</button>
                  </div>
                  {source === "coffer" && <label><span>Backup passphrase (if used)</span><input type="password" value={importPassword} onChange={(event) => setImportPassword(event.target.value)} placeholder="Enter the passphrase if this backup is protected" autoComplete="new-password" disabled={busy} /></label>}
                  {source === "2fas" && <label><span>2FAS backup password</span><input type="password" value={importPassword} onChange={(event) => setImportPassword(event.target.value)} placeholder="Enter the password used for this backup" autoComplete="new-password" disabled={busy} /><small>Leave this blank only if the 2FAS backup was exported without a password.</small></label>}
                </div>
              )}
              <input ref={fileInput} className="visually-hidden" type="file" accept=".coffer,.2fas,.json,.txt,application/json,text/plain" aria-label="Choose an import file" tabIndex={-1} onChange={handleFile} />
              <div className="transfer-footer"><p><span className="mini-lock" /> Files are processed in this browser. Approved imports are encrypted before storage.</p><button className="transfer-primary" onClick={() => void prepareImport()} disabled={busy}>{busy ? "Checking accounts…" : "Review accounts"} <span>→</span></button></div>
            </>
          )}
        </div>
      ) : (
        <div className="export-stack">
          <section className="export-card recommended">
            <div className="export-card-head"><span className="export-icon encrypted" aria-hidden="true" /><div><p>RECOMMENDED</p><h2>Coffer backup</h2><span>Create a complete backup containing accounts, groups, favorites, custom logos, and TOTP settings. Add a passphrase for protection, or leave both fields blank.</span></div></div>
            <div className="export-fields">
              <label><span>Backup passphrase (optional)</span><input type="password" value={exportPassword} onChange={(event) => { setExportPassword(event.target.value); setUnprotectedBackupConfirm(false); }} placeholder="Leave blank or use 12+ characters" autoComplete="new-password" disabled={busy} /></label>
              <label><span>Confirm passphrase</span><input type="password" value={exportPasswordConfirm} onChange={(event) => { setExportPasswordConfirm(event.target.value); setUnprotectedBackupConfirm(false); }} placeholder="Repeat it if used" autoComplete="new-password" disabled={busy} /></label>
            </div>
            <div className="backup-passphrase-important export-passphrase-important" role="note"><span className="backup-passphrase-important-title"><span className="backup-passphrase-important-icon" aria-hidden="true">!</span>Important</span><small>Without a passphrase, anyone with this file can read your authentication secrets. Coffer cannot recover a forgotten passphrase.</small></div>
            {unprotectedBackupConfirm ? (
              <div className="final-confirm" role="alertdialog" aria-labelledby="unprotected-backup-confirm-title" aria-describedby="unprotected-backup-confirm-description">
                <div><strong id="unprotected-backup-confirm-title">Create export without a passphrase?</strong><span id="unprotected-backup-confirm-description">The downloaded file will contain readable authentication secrets.</span></div>
                <button ref={unprotectedBackupBackRef} type="button" onClick={() => { restoreCofferExportFocusRef.current = true; setUnprotectedBackupConfirm(false); }} disabled={busy}>Go back</button>
                <button type="button" onClick={() => void createCofferExport(true)} disabled={busy}>{exporting === "coffer" ? "Creating export…" : "Download unprotected export"}</button>
              </div>
            ) : (
              <div className="export-card-footer"><p>If you use a passphrase, store it separately from the backup file.</p><button ref={cofferExportButtonRef} className="transfer-primary" onClick={() => void createCofferExport()} disabled={busy}>{exporting === "coffer" ? "Creating export…" : exportPassword || exportPasswordConfirm ? "Create protected backup" : "Create unprotected export"} <span>↓</span></button></div>
            )}
          </section>

          <section className="export-card interoperable">
            <div className="export-card-head"><span className="export-icon twofas" aria-hidden="true" /><div><p>2FAS COMPATIBLE</p><h2>2FAS mobile backup</h2><span>Create a .2fas file for the mobile app. Account secrets are password-protected; 2FAS metadata and group names may remain readable. Archived accounts and custom logos are excluded.</span></div></div>
            <div className="export-fields">
              <label><span>2FAS backup passphrase</span><input type="password" value={twoFasExportPassword} onChange={(event) => setTwoFasExportPassword(event.target.value)} placeholder="At least 12 characters" autoComplete="new-password" disabled={busy} /></label>
              <label><span>Confirm passphrase</span><input type="password" value={twoFasExportPasswordConfirm} onChange={(event) => setTwoFasExportPasswordConfirm(event.target.value)} placeholder="Repeat your passphrase" autoComplete="new-password" disabled={busy} /></label>
            </div>
            <div className="export-card-footer"><p>Use 12+ printable ASCII characters for iOS and Android compatibility. 2FAS cannot recover this passphrase.</p><button className="transfer-primary" onClick={() => void createTwoFasExport()} disabled={busy}>{exporting === "2fas" ? "Creating 2fas export…" : "Create 2fas export"} <span>↓</span></button></div>
          </section>

          <section className={`export-card danger ${plainOpen ? "open" : ""}`}>
            <button className="danger-toggle" aria-expanded={plainOpen} aria-controls="plaintext-export-options" onClick={() => { setPlainOpen((value) => !value); setPlainConfirm(false); }}><span className="export-icon readable" /><span><em>Not recommended</em><strong>Plaintext export</strong><small>Export interoperable files containing readable secrets.</small></span><i>{plainOpen ? "−" : "+"}</i></button>
            {plainOpen && <div className="danger-body" id="plaintext-export-options">
              <div className="danger-warning"><strong>Your authentication secrets will be readable without a password.</strong><span>Anyone with this file can generate your verification codes.</span></div>
              <div className="plain-options">
                <label htmlFor="plain-otp" aria-label="OTPAuth URI list"><input id="plain-otp" type="radio" name="plain-format" checked={plainFormat === "otp"} onChange={() => setPlainFormat("otp")} /><span><strong>OTPAuth URI list</strong><small>Interoperable text file · .txt</small></span></label>
                <label htmlFor="plain-json" aria-label="Plain Coffer JSON"><input id="plain-json" type="radio" name="plain-format" checked={plainFormat === "json"} onChange={() => setPlainFormat("json")} /><span><strong>Plain Coffer JSON</strong><small>Readable complete backup · .json</small></span></label>
              </div>
              <label className="danger-check"><input type="checkbox" checked={plainAcknowledged} onChange={(event) => setPlainAcknowledged(event.target.checked)} /><span>I understand this file contains unencrypted authentication secrets.</span></label>
              {plainConfirm ? <div className="final-confirm" role="alertdialog" aria-labelledby="plaintext-confirm-title"><div><strong id="plaintext-confirm-title">Export readable secrets?</strong><span>This cannot be undone after the file is downloaded.</span></div><button onClick={() => setPlainConfirm(false)}>Go back</button><button onClick={exportPlaintext}>Export anyway</button></div> : <div className="danger-actions"><button onClick={() => { if (!plainAcknowledged) setError("Confirm that you understand this file contains unencrypted secrets."); else setPlainConfirm(true); }} disabled={!plainAcknowledged}>Export unencrypted file</button></div>}
            </div>}
          </section>
        </div>
      )}
    </section>
  );
}
