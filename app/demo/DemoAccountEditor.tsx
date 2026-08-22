"use client";

import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { isTotpExpiring, type TotpAlgorithm } from "../../lib/totp";
import type { VaultAccount } from "../../lib/vault-model";
import ServiceLogo, {
  COFFER_INITIALS_BRAND_ID,
  isServiceBrandId,
  serviceBrandById,
} from "../ServiceLogo";
import { demoServiceBrandOptions } from "./demo-logo-options";

export type DemoAccountEditorCodePreview = {
  current: string | null;
  next: string | null;
  remaining: number;
  period: number;
};

export type DemoAccountEditorPatch = Pick<
  VaultAccount,
  "service" | "identity" | "iconBrand" | "algorithm" | "digits" | "period"
>;

export type DemoAccountEditorProps = {
  account: VaultAccount | null;
  codePreview?: DemoAccountEditorCodePreview;
  onClose: () => void;
  onSave: (accountId: string, patch: DemoAccountEditorPatch) => void;
  returnFocusTo?: HTMLElement | null;
  renderIcon?: (values: Pick<VaultAccount, "color" | "letter" | "iconBrand" | "iconDataUrl"> & { service: string }) => ReactNode;
};

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function cleanDemoText(value: string, label: string) {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > 256 || hasControlCharacters(cleaned)) {
    throw new Error(`${label} must be between 1 and 256 characters.`);
  }
  return cleaned;
}

function validateDemoAccount(values: DemoAccountEditorPatch): DemoAccountEditorPatch {
  const service = cleanDemoText(values.service, "Service name");
  const identity = cleanDemoText(values.identity, "Username");
  if (values.algorithm !== "SHA-1" && values.algorithm !== "SHA-256" && values.algorithm !== "SHA-512") {
    throw new Error("Choose a supported TOTP algorithm.");
  }
  if (values.digits !== 6 && values.digits !== 8) throw new Error("Digit count must be 6 or 8.");
  if (!Number.isInteger(values.period) || values.period < 1 || values.period > 300) {
    throw new Error("Period must be a whole number between 1 and 300 seconds.");
  }
  if (values.iconBrand !== null && !isServiceBrandId(values.iconBrand)) {
    throw new Error("Choose a logo from Coffer's local catalog.");
  }

  return {
    service,
    identity,
    iconBrand: values.iconBrand,
    algorithm: values.algorithm,
    digits: values.digits,
    period: values.period,
  };
}

function DemoAccountEditorForm({ account, codePreview, onClose, onSave, returnFocusTo, renderIcon }: Omit<DemoAccountEditorProps, "account"> & { account: VaultAccount }) {
  const titleId = useId();
  const descriptionId = useId();
  const logoPickerId = useId();
  const [service, setService] = useState(account.service);
  const [identity, setIdentity] = useState(account.identity);
  const [iconBrand, setIconBrand] = useState(() => (
    isServiceBrandId(account.iconBrand) ? account.iconBrand : ""
  ));
  const [logoSearch, setLogoSearch] = useState("");
  const [algorithm, setAlgorithm] = useState<TotpAlgorithm>(account.algorithm);
  const [digits, setDigits] = useState<6 | 8>(account.digits);
  const [period, setPeriod] = useState(account.period);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const serviceInputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const restoreFocusFrameRef = useRef<number | null>(null);
  const effectiveLogoQuery = logoSearch.trim() || service.trim();
  const availableLogoOptions = useMemo(
    () => demoServiceBrandOptions(effectiveLogoQuery, iconBrand),
    [effectiveLogoQuery, iconBrand],
  );
  const selectedLogo = iconBrand && iconBrand !== COFFER_INITIALS_BRAND_ID
    ? serviceBrandById(iconBrand)
    : null;

  const renderLogo = (brandId: string | null) => {
    const validatedBrandId = isServiceBrandId(brandId) ? brandId : null;
    const values = {
      color: account.color,
      letter: accountInitials(service) || account.letter,
      service,
      iconBrand: validatedBrandId,
      iconDataUrl: null,
    };
    return renderIcon?.(values) ?? <ServiceLogo
      color={values.color}
      fallback={values.letter}
      service={values.service}
      brandId={validatedBrandId}
      iconDataUrl={null}
    />;
  };

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (restoreFocusFrameRef.current !== null) window.cancelAnimationFrame(restoreFocusFrameRef.current);
    restoreFocusFrameRef.current = null;
    openerRef.current = returnFocusTo
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    serviceInputRef.current?.focus({ preventScroll: true });
    const opener = openerRef.current;

    return () => {
      document.body.style.overflow = previousOverflow;
      restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
        restoreFocusFrameRef.current = null;
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, [returnFocusTo]);

  const handleDialogKeyDown = useCallback((event: globalThis.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
  }, [close]);

  useEffect(() => {
    document.addEventListener("keydown", handleDialogKeyDown, true);
    return () => document.removeEventListener("keydown", handleDialogKeyDown, true);
  }, [handleDialogKeyDown]);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      const patch = validateDemoAccount({
        service,
        identity,
        iconBrand: iconBrand || null,
        algorithm,
        digits,
        period,
      });
      onSave(account.id, patch);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The sample account could not be updated.");
    }
  };

  const codeExpiring = Boolean(codePreview && isTotpExpiring(codePreview.remaining));

  return (
    <div className="account-editor-backdrop">
      <button type="button" className="account-editor-backdrop-dismiss" aria-label="Close demo account editor" onClick={close} tabIndex={-1} />
      <section ref={dialogRef} className="account-editor" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <header className="account-editor-header">
          <div>
            <p className="eyebrow"><span /> ACCOUNT DETAILS</p>
            <h2 id={titleId}>Edit account</h2>
            <p id={descriptionId}>Preview changes to the service, sign-in identity, or TOTP settings. Demo changes reset on refresh or automatically after one hour.</p>
          </div>
          <button type="button" className="account-editor-close" aria-label="Close demo account editor" onClick={close}>×</button>
        </header>

        <form className="account-editor-form" onSubmit={save}>
          <div className="account-editor-icon-row">
            {renderLogo(iconBrand)}
            <div className="account-editor-icon-picker">
              <label htmlFor={`${logoPickerId}-search`}>Platform logo</label>
              <input
                id={`${logoPickerId}-search`}
                type="search"
                value={logoSearch}
                onChange={(event) => setLogoSearch(event.target.value)}
                placeholder={`Search logos for ${service || "this service"}`}
                autoComplete="off"
              />
              <small>{selectedLogo
                ? `${selectedLogo.title} — ${selectedLogo.variantLabel} selected from Coffer's local catalog.`
                : iconBrand === COFFER_INITIALS_BRAND_ID
                  ? "The colored initials tile is selected."
                  : "Automatic matching follows the service name. Choose another local logo below if you prefer."}</small>
            </div>
          </div>

          <fieldset className="account-editor-logo-fieldset demo-account-editor-logo-fieldset">
            <legend>Choose platform logo</legend>
            <div className="account-editor-custom-logo">
              <div>
                <strong>Custom logo</strong>
                <small id={`${titleId}-upload-help`}>In the full app, PNG, JPEG, or WebP files up to 5 MB are fitted to 128 × 128 on your device and stored inside your encrypted vault.</small>
              </div>
              <div className="account-editor-custom-logo-actions">
                <button
                  type="button"
                  className="demo-logo-upload-button"
                  disabled
                  aria-disabled="true"
                  aria-describedby={`${titleId}-upload-help ${titleId}-upload-disabled`}
                >Upload logo</button>
              </div>
              <span className="account-editor-logo-status" id={`${titleId}-upload-disabled`}>Disabled in the public demo. No file picker is connected.</span>
            </div>

            <div className="account-editor-logo-grid">
              <label className="account-editor-logo-option">
                <input
                  type="radio"
                  name={`${logoPickerId}-choice`}
                  value=""
                  checked={!iconBrand}
                  onChange={() => setIconBrand("")}
                />
                {renderLogo(null)}
                <span><strong>Automatic</strong><small>Match service name</small></span>
              </label>
              <label className="account-editor-logo-option">
                <input
                  type="radio"
                  name={`${logoPickerId}-choice`}
                  value={COFFER_INITIALS_BRAND_ID}
                  checked={iconBrand === COFFER_INITIALS_BRAND_ID}
                  onChange={() => setIconBrand(COFFER_INITIALS_BRAND_ID)}
                />
                {renderLogo(COFFER_INITIALS_BRAND_ID)}
                <span><strong>Initials</strong><small>Colored letter tile</small></span>
              </label>
              {availableLogoOptions.map((option) => (
                <label className="account-editor-logo-option" key={option.id}>
                  <input
                    type="radio"
                    name={`${logoPickerId}-choice`}
                    value={option.id}
                    checked={iconBrand === option.id}
                    onChange={() => setIconBrand(option.id)}
                  />
                  {renderLogo(option.id)}
                  <span><strong>{option.title}</strong><small>{option.variantLabel}</small></span>
                </label>
              ))}
            </div>
          </fieldset>

          {codePreview && (
            <div className="account-editor-code-panel" role="group" aria-label={`Live sample codes for ${account.service}`}>
              <div className={`account-editor-current-code ${codeExpiring ? "expiring" : ""}`}>
                <span aria-hidden="true">Current</span>
                <strong aria-hidden="true">{codePreview.current ?? "--- ---"}</strong>
                <span className="visually-hidden">{codePreview.current
                  ? `Current sample code ${codePreview.current.replace(/\s/gu, "").split("").join(" ")}`
                  : "Current sample code loading"}</span>
              </div>
              <div className={`account-editor-next-code ${codeExpiring ? "visible" : ""}`} aria-hidden={!codeExpiring}>
                <span aria-hidden="true">Next</span>
                <strong aria-hidden="true">{codePreview.next ?? "--- ---"}</strong>
                <span className="visually-hidden">{codePreview.next
                  ? `Next sample code ${codePreview.next.replace(/\s/gu, "").split("").join(" ")}`
                  : "Next sample code loading"}</span>
              </div>
              <div
                className={`countdown ${codeExpiring ? "urgent" : ""}`}
                style={{ "--progress": `${(codePreview.remaining / codePreview.period) * 360}deg` } as CSSProperties}
              >
                <span aria-hidden="true">{codePreview.remaining}</span>
                <span className="visually-hidden">{codePreview.remaining} seconds remaining</span>
              </div>
              <p>Codes use the current sample settings until you save these changes.</p>
            </div>
          )}

          <div className="account-editor-grid">
            <label><span>Service name</span><input ref={serviceInputRef} value={service} onChange={(event) => setService(event.target.value)} maxLength={256} /></label>
            <label><span>Username</span><input value={identity} onChange={(event) => setIdentity(event.target.value)} maxLength={256} autoComplete="off" /></label>
            <label className="account-editor-group"><span>Group</span><input value={account.group} readOnly aria-readonly="true" /><small>Move accounts between groups from selection mode in the full app.</small></label>
            <div className="account-editor-secret demo-account-editor-secret">
              <span>Secret key</span>
              <div className="demo-account-secret-readonly" role="note">
                <span aria-hidden="true">•••• •••• •••• ••••</span>
                <strong>Read-only in demo</strong>
              </div>
              <p className="account-editor-secret-test-feedback">Secret editing and testing are unavailable in the public demo. Never enter real secrets here.</p>
            </div>
            <label><span>Digits</span><select value={digits} onChange={(event) => setDigits(Number(event.target.value) as 6 | 8)}><option value="6">6 digits</option><option value="8">8 digits</option></select></label>
            <label><span>Algorithm</span><select value={algorithm} onChange={(event) => setAlgorithm(event.target.value as TotpAlgorithm)}><option value="SHA-1">SHA-1</option><option value="SHA-256">SHA-256</option><option value="SHA-512">SHA-512</option></select></label>
            <label><span>Period</span><span className="account-editor-period"><input type="number" min={1} max={300} step={1} value={period} onChange={(event) => setPeriod(Number(event.target.value))} /><small>seconds</small></span></label>
          </div>

          {error && <p className="account-editor-error" role="alert">{error}</p>}
          <footer className="account-editor-actions">
            <button type="button" onClick={close}>Cancel</button>
            <button type="submit">Save demo changes</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function accountInitials(service: string) {
  const words = service.trim().split(/\s+/u);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : service.slice(0, 2)).slice(0, 3).toUpperCase();
}

export default function DemoAccountEditor({ account, codePreview, onClose, onSave, returnFocusTo, renderIcon }: DemoAccountEditorProps) {
  if (!account) return null;
  return <DemoAccountEditorForm key={account.id} account={account} codePreview={codePreview} onClose={onClose} onSave={onSave} returnFocusTo={returnFocusTo} renderIcon={renderIcon} />;
}
