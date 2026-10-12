"use client";

import { useId, useMemo } from "react";
import { compareVaultConflictVersions, type VaultConflictAccountChange, type VaultConflictAccountSummary, type VaultConflictValueChange } from "../lib/vault-conflict";
import type { PersistedVault } from "../lib/vault-model";

type VaultConflictPanelProps = {
  browserVault: PersistedVault | null;
  serverVault: PersistedVault;
  saveError: string | null;
  busy: boolean;
  onOpenBackup: () => void;
  onUseServer: () => void;
  onKeepBrowser: () => void;
};

const MAX_VISIBLE_ACCOUNT_DIFFERENCES = 50;

function formatVaultTime(value: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toISOString().replace("T", " ").replace(/\.\d{3}Z$/u, " UTC");
}

function AccountList({ items, empty }: { items: VaultConflictAccountSummary[]; empty: string }) {
  if (items.length === 0) return <p className="vault-conflict-empty">{empty}</p>;
  const visibleItems = items.slice(0, MAX_VISIBLE_ACCOUNT_DIFFERENCES);
  return <ul>
    {visibleItems.map((item) => <li key={item.id}>{item.label}</li>)}
    {items.length > visibleItems.length && <li>+{items.length - visibleItems.length} more accounts</li>}
  </ul>;
}

function ValueChangeList({ changes }: { changes: VaultConflictValueChange[] }) {
  return <ul className="vault-conflict-value-changes">{changes.map((change) => <li key={change.field}>
    <strong>{change.field}</strong>
    <span><b>Browser</b><span>{change.browserValue}</span></span>
    <span><b>Server</b><span>{change.serverValue}</span></span>
  </li>)}</ul>;
}

function ChangedAccountList({ items }: { items: VaultConflictAccountChange[] }) {
  if (items.length === 0) return <p className="vault-conflict-empty">No accounts differ in both copies.</p>;
  const visibleItems = items.slice(0, MAX_VISIBLE_ACCOUNT_DIFFERENCES);
  return <ul>{visibleItems.map((item) => {
    const labelChanged = item.browserLabel !== item.serverLabel;
    return <li key={item.id}>
      <strong>{labelChanged ? `${item.browserLabel} ↔ ${item.serverLabel}` : item.browserLabel}</strong>
      <ValueChangeList changes={item.changes} />
    </li>;
  })}
    {items.length > visibleItems.length && <li>+{items.length - visibleItems.length} more changed accounts</li>}
  </ul>;
}

export default function VaultConflictPanel({
  browserVault,
  serverVault,
  saveError,
  busy,
  onOpenBackup,
  onUseServer,
  onKeepBrowser,
}: VaultConflictPanelProps) {
  const titleId = useId();
  const difference = useMemo(
    () => browserVault ? compareVaultConflictVersions(browserVault, serverVault) : null,
    [browserVault, serverVault],
  );
  const otherChanges = difference ? [
    ...difference.profileChanges,
    ...difference.settingsChanges,
    ...difference.groupChanges,
    ...(difference.accountOrderChange ? [difference.accountOrderChange] : []),
  ] : [];

  return <section className="vault-conflict-panel transfer-error" aria-labelledby={titleId}>
    <span className="vault-conflict-alert-icon" aria-hidden="true">!</span>
    <div className="vault-conflict-copy" role="alert" aria-live="assertive">
      <strong id={titleId}>Choose which encrypted vault version to keep</strong>
      <p>
        {browserVault
          ? "This browser has pending changes, while the server has a newer version. Review the differences before choosing. Nothing will be overwritten until you choose."
          : "The browser recovery record cannot be opened with this vault. Keep the server version to discard only that unreadable local record."}
      </p>
      {browserVault && <p>Coffer cannot merge these copies automatically. Choosing one replaces the other; export a backup first if you want to preserve both.</p>}
      {saveError && <small>{saveError}</small>}
    </div>
    <div className="vault-conflict-actions">
      <button className="modal-secondary" type="button" onClick={onOpenBackup} disabled={busy}>Open data &amp; backup</button>
      <button className="modal-secondary" type="button" onClick={onUseServer} disabled={busy}>Use server version</button>
      <button className="modal-primary" type="button" onClick={onKeepBrowser} disabled={busy || !browserVault}>{busy ? "Resolving…" : "Keep this browser's changes"}</button>
    </div>
    {difference && <details className="vault-conflict-differences" open>
      <summary>Review differences</summary>
      <div className="vault-conflict-version-grid">
        <section>
          <strong>Browser copy</strong>
          <span>{difference.browserAccountCount} {difference.browserAccountCount === 1 ? "account" : "accounts"}</span>
          <small>Updated <time dateTime={difference.browserUpdatedAt}>{formatVaultTime(difference.browserUpdatedAt)}</time></small>
        </section>
        <section>
          <strong>Server copy</strong>
          <span>{difference.serverAccountCount} {difference.serverAccountCount === 1 ? "account" : "accounts"}</span>
          <small>Updated <time dateTime={difference.serverUpdatedAt}>{formatVaultTime(difference.serverUpdatedAt)}</time></small>
        </section>
      </div>
      <div className="vault-conflict-difference-grid">
        <section>
          <h3>Only in this browser</h3>
          <AccountList items={difference.browserOnlyAccounts} empty="No browser-only accounts." />
        </section>
        <section>
          <h3>Only on the server</h3>
          <AccountList items={difference.serverOnlyAccounts} empty="No server-only accounts." />
        </section>
        <section className="vault-conflict-changed-accounts">
          <h3>Different in both copies</h3>
          <ChangedAccountList items={difference.changedAccounts} />
        </section>
      </div>
      <section className="vault-conflict-other-differences">
        <h3>Other differences</h3>
        {!difference.hasContentDifferences
          ? <p>No content differences were found. Only sync metadata differs.</p>
          : otherChanges.length > 0
            ? <ValueChangeList changes={otherChanges} />
            : <p>No other differences.</p>}
      </section>
      <p className="vault-conflict-secret-note">Secret values and generated codes are never shown. “Secret key” only indicates that the encrypted account details differ.</p>
    </details>}
  </section>;
}
