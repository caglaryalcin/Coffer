"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { VaultAccount } from "../../lib/vault-model";
import ServiceLogo, {
  COFFER_INITIALS_BRAND_ID,
  isServiceBrandId,
} from "../ServiceLogo";
import { demoServiceBrandOptions } from "./demo-logo-options";

export type DemoBulkLogoPickerProps = {
  open: boolean;
  selectedCount: number;
  suggestedService?: string | null;
  previewAccount?: Pick<VaultAccount, "color" | "letter" | "service"> | null;
  returnFocusTo?: HTMLElement | null;
  onApply: (iconBrand: string | null) => boolean | void;
  onClose: () => void;
};

function DemoBulkLogoPickerDialog({
  selectedCount,
  suggestedService,
  previewAccount,
  returnFocusTo,
  onApply,
  onClose,
}: Omit<DemoBulkLogoPickerProps, "open">) {
  const titleId = useId();
  const descriptionId = useId();
  const pickerId = useId();
  const [choice, setChoice] = useState<"automatic" | "catalog">("automatic");
  const [iconBrand, setIconBrand] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    openerRef.current = returnFocusTo
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    searchInputRef.current?.focus({ preventScroll: true });
    const opener = openerRef.current;
    return () => {
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [returnFocusTo]);

  const handleKeyDown = useCallback((event: globalThis.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  const effectiveQuery = query.trim() || suggestedService?.trim() || "";
  const availableOptions = useMemo(
    () => demoServiceBrandOptions(effectiveQuery, iconBrand, effectiveQuery ? 24 : 12),
    [effectiveQuery, iconBrand],
  );
  const selectedOption = choice === "catalog"
    ? availableOptions.find((option) => option.id === iconBrand)
    : undefined;
  const preview = previewAccount ?? { color: "ink" as const, letter: "C", service: "Coffer" };
  const previewBrand = choice === "catalog" && isServiceBrandId(iconBrand) ? iconBrand : null;

  const chooseAutomatic = () => {
    setChoice("automatic");
    setIconBrand("");
    setError("");
  };

  const chooseCatalog = (brandId: string) => {
    setChoice("catalog");
    setIconBrand(brandId);
    setError("");
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedCount < 1) return;
    if (choice === "catalog" && !isServiceBrandId(iconBrand)) {
      setError("Choose a logo from Coffer's local catalog.");
      return;
    }
    const accepted = onApply(choice === "catalog" ? iconBrand : null);
    if (accepted !== false) onClose();
  };

  return (
    <div className="account-editor-backdrop">
      <button type="button" className="account-editor-backdrop-dismiss" aria-label="Close demo bulk logo picker" onClick={close} tabIndex={-1} />
      <section ref={dialogRef} className="account-editor" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
        <header className="account-editor-header">
          <div>
            <p className="eyebrow"><span /> ACCOUNT LOGOS</p>
            <h2 id={titleId}>Change selected logos</h2>
            <p id={descriptionId}>Apply a safe local logo choice to {selectedCount} selected {selectedCount === 1 ? "account" : "accounts"}. Demo changes reset on refresh or automatically after one hour.</p>
          </div>
          <button type="button" className="account-editor-close" aria-label="Close demo bulk logo picker" onClick={close}>×</button>
        </header>

        <form className="account-editor-form" onSubmit={submit}>
          <div className="account-editor-icon-row">
            <ServiceLogo color={preview.color} fallback={preview.letter} service={preview.service} brandId={previewBrand} />
            <div className="account-editor-icon-picker">
              <label htmlFor={`${pickerId}-search`}>Platform logo</label>
              <input
                ref={searchInputRef}
                id={`${pickerId}-search`}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={suggestedService ? `Search logos for ${suggestedService}` : "Search local logos"}
                autoComplete="off"
              />
              <small>{selectedOption
                ? `${selectedOption.title} selected from Coffer's local catalog.`
                : effectiveQuery
                  ? `${availableOptions.length} matching local ${availableOptions.length === 1 ? "logo" : "logos"}.`
                  : "Automatic matching keeps each account linked to its own service name."}</small>
            </div>
          </div>

          <fieldset className="account-editor-logo-fieldset">
            <legend>Choose platform logo</legend>
            <div className="account-editor-custom-logo">
              <div>
                <strong>Custom logo</strong>
                <small id={`${pickerId}-upload-help`}>In the full app, one PNG, JPEG, or WebP logo can be applied to all selected accounts.</small>
              </div>
              <div className="account-editor-custom-logo-actions">
                <button type="button" className="demo-logo-upload-button" disabled aria-disabled="true" aria-describedby={`${pickerId}-upload-help ${pickerId}-upload-disabled`}>Upload logo</button>
              </div>
              <span className="account-editor-logo-status" id={`${pickerId}-upload-disabled`}>Disabled in the public demo. No file picker is connected.</span>
            </div>

            <div className="account-editor-logo-grid">
              <label className="account-editor-logo-option">
                <input type="radio" name={`${pickerId}-choice`} value="" checked={choice === "automatic"} onChange={chooseAutomatic} />
                <ServiceLogo color={preview.color} fallback={preview.letter} service={preview.service} brandId={null} />
                <span><strong>Automatic</strong><small>Match each service</small></span>
              </label>
              <label className="account-editor-logo-option">
                <input type="radio" name={`${pickerId}-choice`} value={COFFER_INITIALS_BRAND_ID} checked={choice === "catalog" && iconBrand === COFFER_INITIALS_BRAND_ID} onChange={() => chooseCatalog(COFFER_INITIALS_BRAND_ID)} />
                <ServiceLogo color={preview.color} fallback={preview.letter} service={preview.service} brandId={COFFER_INITIALS_BRAND_ID} />
                <span><strong>Initials</strong><small>Colored letter tile</small></span>
              </label>
              {availableOptions.map((option) => (
                <label className="account-editor-logo-option" key={option.id}>
                  <input type="radio" name={`${pickerId}-choice`} value={option.id} checked={choice === "catalog" && iconBrand === option.id} onChange={() => chooseCatalog(option.id)} />
                  <ServiceLogo color={preview.color} fallback={preview.letter} service={preview.service} brandId={option.id} />
                  <span><strong>{option.title}</strong><small>{option.variantLabel}</small></span>
                </label>
              ))}
            </div>
          </fieldset>

          {error && <p className="account-editor-error" role="alert">{error}</p>}
          <div className="account-editor-actions">
            <button type="button" onClick={close}>Cancel</button>
            <button type="submit" disabled={selectedCount < 1 || (choice === "catalog" && !iconBrand)}>Apply to {selectedCount}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function DemoBulkLogoPicker({ open, ...props }: DemoBulkLogoPickerProps) {
  if (!open) return null;
  return <DemoBulkLogoPickerDialog {...props} />;
}
