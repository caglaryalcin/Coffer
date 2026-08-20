"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { ACCOUNT_LOGO_ACCEPT, prepareAccountLogo } from "./account-logo";
import {
  accountSecretTestReadiness,
  accountEditorReturnFocusTarget,
  accountEditorValues,
  validateAccountEditorValues,
  type EditableAccountPatch,
} from "../lib/account-editor";
import { generateTotpTestPreview, isTotpExpiring, type TotpAlgorithm, type TotpTestPreview } from "../lib/totp";
import type { VaultAccount } from "../lib/vault-model";

export type AccountIconOption = {
  id: string;
  label: string;
};

export type AccountEditorCodePreview = {
  current: string | null;
  next: string | null;
  remaining: number;
  period: number;
};

export type AccountEditorProps = {
  account: VaultAccount | null;
  brandOptions: readonly AccountIconOption[];
  codePreview?: AccountEditorCodePreview;
  onClose: () => void;
  onSave: (accountId: string, patch: EditableAccountPatch) => void | Promise<void>;
  returnFocusTo?: HTMLElement | null;
  renderIcon?: (values: Pick<VaultAccount, "color" | "letter"> & { service: string; iconBrand: string | null; iconDataUrl: string | null }) => ReactNode;
};

type SecretTestFeedback =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; preview: TotpTestPreview }
  | { status: "error" };

function iconSearchKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

export function findAccountIconOptions(
  options: readonly AccountIconOption[],
  query: string,
  selectedId: string | null,
  limit = 12,
) {
  const normalizedQuery = iconSearchKey(query);
  const ignoredTokens = new Set(["2fa", "account", "authenticator", "login", "totp"]);
  const queryTokens = normalizedQuery.split(/\s+/u).filter((token) => token && !ignoredTokens.has(token));
  const effectiveTokens = queryTokens.length > 0 ? queryTokens : normalizedQuery ? [normalizedQuery] : [];

  const scored = normalizedQuery ? options.flatMap((option) => {
    const label = iconSearchKey(option.label);
    const id = iconSearchKey(option.id);
    const searchable = `${label} ${id}`;
    const score = label === normalizedQuery || id === normalizedQuery
      ? 0
      : label.startsWith(normalizedQuery) || id.startsWith(normalizedQuery)
        ? 1
        : searchable.includes(normalizedQuery)
          ? 2
          : effectiveTokens.every((token) => searchable.includes(token))
            ? 3
            : effectiveTokens.some((token) => searchable.includes(token))
              ? 4
              : Number.POSITIVE_INFINITY;
    return Number.isFinite(score) ? [{ option, score }] : [];
  }).sort((left, right) => left.score - right.score || left.option.label.localeCompare(right.option.label, "en")) : [];

  const selected = selectedId ? options.find((option) => option.id === selectedId) : undefined;
  const results = selected ? [selected] : [];
  for (const { option } of scored) {
    if (!results.some((result) => result.id === option.id)) results.push(option);
    if (results.length >= Math.max(1, limit)) break;
  }
  return results.slice(0, Math.max(1, limit));
}

function AccountEditorForm({ account, brandOptions, codePreview, onClose, onSave, returnFocusTo, renderIcon }: Omit<AccountEditorProps, "account"> & { account: VaultAccount }) {
  const initial = accountEditorValues(account);
  const titleId = useId();
  const descriptionId = useId();
  const iconPickerId = useId();
  const secretInputId = useId();
  const secretTestFeedbackId = useId();
  const [service, setService] = useState(initial.service);
  const [identity, setIdentity] = useState(initial.identity);
  const [secret, setSecret] = useState(initial.secret);
  const [iconBrand, setIconBrand] = useState(initial.iconBrand ?? "");
  const [iconDataUrl, setIconDataUrl] = useState(initial.iconDataUrl);
  const [iconQuery, setIconQuery] = useState("");
  const [algorithm, setAlgorithm] = useState<TotpAlgorithm>(initial.algorithm);
  const [digits, setDigits] = useState<6 | 8>(initial.digits);
  const [period, setPeriod] = useState(initial.period);
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [secretTestFeedback, setSecretTestFeedback] = useState<SecretTestFeedback>({ status: "idle" });
  const dialogRef = useRef<HTMLElement>(null);
  const serviceInputRef = useRef<HTMLInputElement>(null);
  const secretInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoRequestRef = useRef(0);
  const secretTestRequestRef = useRef(0);
  const secretTestExpiryTimerRef = useRef<number | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const restoreFocusFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (restoreFocusFrameRef.current !== null) window.cancelAnimationFrame(restoreFocusFrameRef.current);
    restoreFocusFrameRef.current = null;
    openerRef.current = accountEditorReturnFocusTarget(
      returnFocusTo,
      document.activeElement instanceof HTMLElement ? document.activeElement : null,
    );
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    serviceInputRef.current?.focus({ preventScroll: true });
    const secretInput = secretInputRef.current;
    const opener = openerRef.current;

    return () => {
      logoRequestRef.current += 1;
      secretTestRequestRef.current += 1;
      if (secretTestExpiryTimerRef.current !== null) window.clearTimeout(secretTestExpiryTimerRef.current);
      document.body.style.overflow = previousOverflow;
      if (secretInput) secretInput.value = "";
      restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
        restoreFocusFrameRef.current = null;
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, [returnFocusTo]);

  const resetSecretTest = useCallback(() => {
    secretTestRequestRef.current += 1;
    if (secretTestExpiryTimerRef.current !== null) {
      window.clearTimeout(secretTestExpiryTimerRef.current);
      secretTestExpiryTimerRef.current = null;
    }
    setSecretTestFeedback({ status: "idle" });
  }, []);

  const scrubSecret = useCallback(() => {
    resetSecretTest();
    if (secretInputRef.current) secretInputRef.current.value = "";
    setSecret("");
    setShowSecret(false);
  }, [resetSecretTest]);

  const close = useCallback(() => {
    if (busy) return;
    scrubSecret();
    onClose();
  }, [busy, onClose, scrubSecret]);

  const handleDialogKeyDown = useCallback((event: globalThis.KeyboardEvent) => {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, [busy, close]);

  useEffect(() => {
    document.addEventListener("keydown", handleDialogKeyDown, true);
    return () => document.removeEventListener("keydown", handleDialogKeyDown, true);
  }, [handleDialogKeyDown]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    resetSecretTest();
    try {
      const patch = validateAccountEditorValues({
        service,
        identity,
        secret,
        iconBrand: iconBrand || null,
        iconDataUrl,
        algorithm,
        digits,
        period,
      }, brandOptions.map((option) => option.id));
      setBusy(true);
      await onSave(account.id, patch);
      scrubSecret();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The account could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  const chooseAutomaticLogo = () => {
    setIconBrand("");
    setIconDataUrl(null);
    setLogoError("");
  };

  const chooseCatalogLogo = (brandId: string) => {
    setIconBrand(brandId);
    setIconDataUrl(null);
    setLogoError("");
  };

  const removeUploadedLogo = () => {
    logoRequestRef.current += 1;
    setIconBrand("");
    setIconDataUrl(null);
    setLogoBusy(false);
    setLogoError("");
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  const uploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    const request = logoRequestRef.current + 1;
    logoRequestRef.current = request;
    setLogoBusy(true);
    setLogoError("");
    try {
      const nextIconDataUrl = await prepareAccountLogo(file);
      if (logoRequestRef.current !== request) return;
      setIconBrand("");
      setIconDataUrl(nextIconDataUrl);
    } catch (caught) {
      if (logoRequestRef.current !== request) return;
      setLogoError(caught instanceof Error ? caught.message : "The selected logo could not be processed.");
    } finally {
      if (logoRequestRef.current === request) setLogoBusy(false);
    }
  };

  const selectedIcon = brandOptions.find((option) => option.id === iconBrand);
  const logoSearch = iconQuery.trim() || service.trim();
  const visibleIconOptions = useMemo(() => {
    return findAccountIconOptions(brandOptions, logoSearch, iconBrand || null);
  }, [brandOptions, iconBrand, logoSearch]);
  const codeExpiring = Boolean(codePreview && isTotpExpiring(codePreview.remaining));
  const secretTestReadiness = useMemo(() => accountSecretTestReadiness(initial.secret, {
    secret,
    algorithm,
    digits,
    period,
  }), [algorithm, digits, initial.secret, period, secret]);
  const secretTestBusy = secretTestFeedback.status === "testing";
  const secretTestDisabled = busy || logoBusy || secretTestBusy || secretTestReadiness.status !== "ready";
  const secretTestHint = secretTestFeedback.status === "testing"
    ? "Generating a test code locally…"
    : secretTestReadiness.status === "unchanged"
      ? "Enter a different valid Base32 secret to enable Test."
      : secretTestReadiness.status === "invalid"
        ? secretTestReadiness.message
        : "Generate a code locally from this unsaved secret.";

  const changeSecret = (value: string) => {
    resetSecretTest();
    setSecret(value);
  };

  const changeAlgorithm = (value: TotpAlgorithm) => {
    resetSecretTest();
    setAlgorithm(value);
  };

  const changeDigits = (value: 6 | 8) => {
    resetSecretTest();
    setDigits(value);
  };

  const changePeriod = (value: number) => {
    resetSecretTest();
    setPeriod(value);
  };

  const testSecret = async () => {
    if (secretTestReadiness.status !== "ready" || secretTestDisabled) return;

    const request = secretTestRequestRef.current + 1;
    secretTestRequestRef.current = request;
    if (secretTestExpiryTimerRef.current !== null) {
      window.clearTimeout(secretTestExpiryTimerRef.current);
      secretTestExpiryTimerRef.current = null;
    }
    setSecretTestFeedback({ status: "testing" });

    try {
      let preview = await generateTotpTestPreview(secretTestReadiness.configuration);
      if (secretTestRequestRef.current !== request) return;
      if (Date.now() >= preview.expiresAt) {
        preview = await generateTotpTestPreview(secretTestReadiness.configuration);
      }
      if (secretTestRequestRef.current !== request) return;
      if (Date.now() >= preview.expiresAt) throw new Error("The generated code expired before it could be shown.");

      setSecretTestFeedback({ status: "success", preview });
      const expiryTimer = window.setTimeout(() => {
        if (secretTestRequestRef.current === request) setSecretTestFeedback({ status: "idle" });
        if (secretTestExpiryTimerRef.current === expiryTimer) secretTestExpiryTimerRef.current = null;
      }, Math.max(0, preview.expiresAt - Date.now()));
      secretTestExpiryTimerRef.current = expiryTimer;
    } catch {
      if (secretTestRequestRef.current === request) setSecretTestFeedback({ status: "error" });
    }
  };

  return (
    <div className="account-editor-backdrop">
      <button type="button" className="account-editor-backdrop-dismiss" aria-label="Close account editor" onClick={close} disabled={busy} tabIndex={-1} />
      <section ref={dialogRef} className="account-editor" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <header className="account-editor-header">
          <div>
            <p className="eyebrow"><span /> ACCOUNT DETAILS</p>
            <h2 id={titleId}>Edit account</h2>
            <p id={descriptionId}>Update the service, sign-in identity, icon, or TOTP settings.</p>
          </div>
          <button type="button" className="account-editor-close" aria-label="Close account editor" onClick={close} disabled={busy}>×</button>
        </header>

        <form className="account-editor-form" onSubmit={save}>
          <div className="account-editor-icon-row">
            {renderIcon?.({ color: account.color, letter: account.letter, service, iconBrand: iconBrand || null, iconDataUrl }) ?? (
              <span className={`service-logo ${account.color}`} aria-hidden="true">{account.letter}</span>
            )}
            <div className="account-editor-icon-picker">
              <label htmlFor={`${iconPickerId}-search`}>Platform logo</label>
              <input
                id={`${iconPickerId}-search`}
                type="search"
                value={iconQuery}
                onChange={(event) => setIconQuery(event.target.value)}
                placeholder={`Search logos for ${service.trim() || "this platform"}`}
                autoComplete="off"
              />
              <small>{iconDataUrl
                ? "Uploaded logo selected for this account."
                : selectedIcon
                ? `${selectedIcon.label} selected from Coffer's local catalog.`
                : visibleIconOptions.length === 0
                  ? "No catalog logos match. Automatic matching remains selected."
                  : iconQuery
                    ? `${visibleIconOptions.length} matching local logos. Choose one below.`
                    : "Suggested logos are based on the service name. Choose one or keep automatic matching."}</small>
            </div>
          </div>

          <fieldset className="account-editor-logo-fieldset" disabled={busy || logoBusy}>
            <legend>Choose platform logo</legend>
            <div className="account-editor-custom-logo" aria-busy={logoBusy}>
              <div>
                <strong>Custom logo</strong>
                <small id={`${iconPickerId}-upload-help`}>PNG, JPEG, or WebP up to 5 MB. Fitted to 128 × 128 on this device and stored inside your encrypted vault.</small>
              </div>
              <div className="account-editor-custom-logo-actions">
                <label className="account-editor-logo-upload">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept={ACCOUNT_LOGO_ACCEPT}
                    aria-describedby={`${iconPickerId}-upload-help`}
                    onChange={uploadLogo}
                  />
                  <span>{logoBusy ? "Processing…" : iconDataUrl ? "Replace logo" : "Upload logo"}</span>
                </label>
                {iconDataUrl && <button type="button" onClick={removeUploadedLogo}>Remove upload</button>}
              </div>
              {logoBusy && <span className="account-editor-logo-status" role="status">Processing logo…</span>}
              {logoError && <span className="account-editor-logo-error" role="alert">{logoError}</span>}
            </div>
            <div className="account-editor-logo-grid">
              <label className="account-editor-logo-option">
                <input
                  type="radio"
                  name={`${iconPickerId}-choice`}
                  value=""
                  checked={!iconBrand && !iconDataUrl}
                  onChange={chooseAutomaticLogo}
                />
                {renderIcon?.({ color: account.color, letter: account.letter, service, iconBrand: null, iconDataUrl: null }) ?? (
                  <span className={`service-logo ${account.color}`} aria-hidden="true">{account.letter}</span>
                )}
                <span><strong>Automatic</strong><small>Match service name</small></span>
              </label>
              {visibleIconOptions.map((option) => (
                <label className="account-editor-logo-option" key={option.id}>
                  <input
                    type="radio"
                    name={`${iconPickerId}-choice`}
                    value={option.id}
                    checked={!iconDataUrl && iconBrand === option.id}
                    onChange={() => chooseCatalogLogo(option.id)}
                  />
                  {renderIcon?.({ color: account.color, letter: account.letter, service, iconBrand: option.id, iconDataUrl: null }) ?? (
                    <span className={`service-logo ${account.color}`} aria-hidden="true">{account.letter}</span>
                  )}
                  <span><strong>{option.label}</strong><small>{option.id}</small></span>
                </label>
              ))}
            </div>
          </fieldset>

          {codePreview && (
            <div className="account-editor-code-panel" role="group" aria-label={`Live codes for ${account.service}`}>
              <div className={`account-editor-current-code ${codeExpiring ? "expiring" : ""}`}>
                <span aria-hidden="true">Current</span>
                <strong aria-hidden="true">{codePreview.current ?? "--- ---"}</strong>
                <span className="visually-hidden">{codePreview.current
                  ? `Current code ${codePreview.current.replace(/\s/gu, "").split("").join(" ")}`
                  : "Current code loading"}</span>
              </div>
              <div className={`account-editor-next-code ${codeExpiring ? "visible" : ""}`} aria-hidden={!codeExpiring}>
                <span aria-hidden="true">Next</span>
                <strong aria-hidden="true">{codePreview.next ?? "--- ---"}</strong>
                <span className="visually-hidden">{codePreview.next
                  ? `Next code ${codePreview.next.replace(/\s/gu, "").split("").join(" ")}`
                  : "Next code loading"}</span>
              </div>
              <div
                className={`countdown ${codeExpiring ? "urgent" : ""}`}
                style={{ "--progress": `${(codePreview.remaining / codePreview.period) * 360}deg` } as CSSProperties}
              >
                <span aria-hidden="true">{codePreview.remaining}</span>
                <span className="visually-hidden">{codePreview.remaining} seconds remaining</span>
              </div>
              <p>Codes use the saved settings until you save these changes.</p>
            </div>
          )}

          <div className="account-editor-grid">
            <label><span>Service name</span><input ref={serviceInputRef} value={service} onChange={(event) => setService(event.target.value)} maxLength={256} /></label>
            <label><span>Username</span><input value={identity} onChange={(event) => setIdentity(event.target.value)} maxLength={256} autoComplete="off" /></label>
            <label className="account-editor-group"><span>Group</span><input value={account.group} readOnly aria-readonly="true" /><small>Move accounts between groups from selection mode.</small></label>
            <div className="account-editor-secret">
              <label htmlFor={secretInputId}>Secret key</label>
              <span className="account-editor-secret-control">
                <input id={secretInputId} ref={secretInputRef} type={showSecret ? "text" : "password"} value={secret} onChange={(event) => changeSecret(event.target.value)} maxLength={1_280} autoComplete="off" spellCheck={false} aria-describedby={secretTestFeedbackId} />
                <button type="button" onClick={() => setShowSecret((shown) => !shown)} aria-pressed={showSecret}>{showSecret ? "Hide" : "Show"}</button>
                <button className="account-editor-test-secret" type="button" onClick={() => void testSecret()} disabled={secretTestDisabled} aria-describedby={secretTestFeedbackId}>{secretTestBusy ? "Testing…" : "Test"}</button>
              </span>
              {secretTestFeedback.status === "success" ? (
                <p id={secretTestFeedbackId} className="account-editor-secret-test-feedback success" role="status" aria-live="polite" aria-atomic="true">
                  <span>Test code</span>
                  <strong aria-hidden="true">{secretTestFeedback.preview.code}</strong>
                  <span className="visually-hidden">Draft code {secretTestFeedback.preview.code.replace(/\s/gu, "").split("").join(" ")}</span>
                  <small>Generated locally from the unsaved secret. Nothing was saved. Compare it with the service before saving.</small>
                </p>
              ) : secretTestFeedback.status === "error" ? (
                <p id={secretTestFeedbackId} className="account-editor-secret-test-feedback error" role="alert">Coffer could not generate a test code. Check the secret and TOTP settings, then try again.</p>
              ) : (
                <p
                  id={secretTestFeedbackId}
                  className="account-editor-secret-test-feedback"
                  role={secretTestBusy ? "status" : undefined}
                  aria-live={secretTestBusy ? "polite" : undefined}
                  aria-atomic={secretTestBusy ? "true" : undefined}
                >{secretTestHint}</p>
              )}
            </div>
            <label><span>Digits</span><select value={digits} onChange={(event) => changeDigits(Number(event.target.value) as 6 | 8)}><option value="6">6 digits</option><option value="8">8 digits</option></select></label>
            <label><span>Algorithm</span><select value={algorithm} onChange={(event) => changeAlgorithm(event.target.value as TotpAlgorithm)}><option value="SHA-1">SHA-1</option><option value="SHA-256">SHA-256</option><option value="SHA-512">SHA-512</option></select></label>
            <label><span>Period</span><span className="account-editor-period"><input type="number" min={1} max={300} step={1} value={period} onChange={(event) => changePeriod(Number(event.target.value))} /><small>seconds</small></span></label>
          </div>

          {error && <p className="account-editor-error" role="alert">{error}</p>}
          <footer className="account-editor-actions">
            <button type="button" onClick={close} disabled={busy}>Cancel</button>
            <button type="submit" disabled={busy || logoBusy || secretTestBusy}>{busy ? "Saving…" : logoBusy ? "Processing…" : "Save changes"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default function AccountEditor({ account, brandOptions, codePreview, onClose, onSave, returnFocusTo, renderIcon }: AccountEditorProps) {
  if (!account) return null;
  return <AccountEditorForm key={account.id} account={account} brandOptions={brandOptions} codePreview={codePreview} onClose={onClose} onSave={onSave} returnFocusTo={returnFocusTo} renderIcon={renderIcon} />;
}
