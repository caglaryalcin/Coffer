"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { accountEditorReturnFocusTarget } from "../lib/account-editor";
import {
  MAX_VAULT_ACCOUNT_ICON_BYTES,
  type VaultAccount,
} from "../lib/vault-model";
import {
  findAccountIconOptions,
  type AccountIconOption,
} from "./AccountEditor";
import { ACCOUNT_LOGO_ACCEPT, prepareAccountLogo } from "./account-logo";
import ServiceLogo, {
  COFFER_INITIALS_BRAND_ID,
  isServiceBrandId,
  serviceBrandOptions,
} from "./ServiceLogo";

export type BulkAccountLogoPatch = Pick<
  VaultAccount,
  "iconBrand" | "iconDataUrl"
>;

export type BulkLogoPickerProps = {
  open: boolean;
  selectedCount: number;
  brandOptions: readonly AccountIconOption[];
  /** Shared platform used to seed suggestions when the search is empty. */
  suggestedService?: string | null;
  /**
   * Custom-logo bytes used by accounts outside the current selection. Replaced
   * selected logos must be excluded so the picker can enforce the vault limit.
   */
  retainedCustomLogoBytes: number;
  previewAccount?: Pick<VaultAccount, "color" | "letter" | "service"> | null;
  disabled?: boolean;
  returnFocusTo?: HTMLElement | null;
  onApply: (
    patch: BulkAccountLogoPatch,
  ) => boolean | void | Promise<boolean | void>;
  onClose: () => void;
};

type LogoChoice = "automatic" | "catalog" | "custom";

export function accountIconDataUrlBytes(value: string | null | undefined) {
  if (!value) return 0;
  const separator = value.indexOf(",");
  if (separator < 0) return 0;
  const encoded = value.slice(separator + 1);
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.max(0, (encoded.length / 4) * 3 - padding);
}

export function retainedAccountIconBytes(
  accounts: readonly Pick<VaultAccount, "id" | "iconDataUrl">[],
  replacingAccountIds: ReadonlySet<string>,
) {
  return accounts.reduce(
    (total, account) => replacingAccountIds.has(account.id)
      ? total
      : total + accountIconDataUrlBytes(account.iconDataUrl),
    0,
  );
}

function BulkLogoPickerDialog({
  selectedCount,
  brandOptions,
  suggestedService,
  retainedCustomLogoBytes,
  previewAccount,
  disabled = false,
  returnFocusTo,
  onApply,
  onClose,
}: Omit<BulkLogoPickerProps, "open">) {
  const titleId = useId();
  const descriptionId = useId();
  const pickerId = useId();
  const [choice, setChoice] = useState<LogoChoice>("automatic");
  const [iconBrand, setIconBrand] = useState("");
  const [iconDataUrl, setIconDataUrl] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [logoBusy, setLogoBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const logoRequestRef = useRef(0);
  const openerRef = useRef<HTMLElement | null>(null);
  const restoreFocusFrameRef = useRef<number | null>(null);
  const unavailable = disabled || busy || logoBusy;
  const suggestedLogoQuery = suggestedService?.trim() ?? "";

  const close = useCallback(() => {
    if (unavailable) return;
    onClose();
  }, [onClose, unavailable]);

  useEffect(() => {
    if (restoreFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrameRef.current);
    }
    restoreFocusFrameRef.current = null;
    openerRef.current = accountEditorReturnFocusTarget(
      returnFocusTo,
      document.activeElement instanceof HTMLElement ? document.activeElement : null,
    );
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    searchInputRef.current?.focus({ preventScroll: true });
    const opener = openerRef.current;

    return () => {
      logoRequestRef.current += 1;
      document.body.style.overflow = previousOverflow;
      restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
        restoreFocusFrameRef.current = null;
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, [returnFocusTo]);

  const handleDialogKeyDown = useCallback((event: globalThis.KeyboardEvent) => {
    if (event.key === "Escape" && !unavailable) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
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
  }, [close, unavailable]);

  useEffect(() => {
    document.addEventListener("keydown", handleDialogKeyDown, true);
    return () => document.removeEventListener("keydown", handleDialogKeyDown, true);
  }, [handleDialogKeyDown]);

  const availableOptions = useMemo(() => {
    const trimmedQuery = query.trim();
    const effectiveQuery = trimmedQuery || suggestedLogoQuery;
    if (effectiveQuery) {
      return findAccountIconOptions(
        brandOptions,
        effectiveQuery,
        choice === "catalog" ? iconBrand : null,
      );
    }

    const optionById = new Map(brandOptions.map((option) => [option.id, option]));
    const initials = optionById.get(COFFER_INITIALS_BRAND_ID);
    const popular = serviceBrandOptions("", 12).flatMap((brand) => {
      const option = optionById.get(brand.id);
      return option ? [option] : [];
    });
    const selected = choice === "catalog" ? optionById.get(iconBrand) : undefined;
    const results = initials ? [initials, ...popular] : popular;
    if (selected && !results.some((option) => option.id === selected.id)) results.splice(initials ? 1 : 0, 0, selected);
    return results.slice(0, 12);
  }, [brandOptions, choice, iconBrand, query, suggestedLogoQuery]);

  const visibleCatalogIconCount = availableOptions.filter(
    (option) => option.id !== COFFER_INITIALS_BRAND_ID,
  ).length;

  const automatic = () => {
    logoRequestRef.current += 1;
    setChoice("automatic");
    setIconBrand("");
    setIconDataUrl(null);
    setLogoBusy(false);
    setLogoError("");
    setError("");
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  const chooseCatalog = (brandId: string) => {
    logoRequestRef.current += 1;
    setChoice("catalog");
    setIconBrand(brandId);
    setIconDataUrl(null);
    setLogoBusy(false);
    setLogoError("");
    setError("");
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
    setError("");
    try {
      const nextIconDataUrl = await prepareAccountLogo(file);
      if (logoRequestRef.current !== request) return;
      const retainedBytes = Math.max(0, Math.floor(retainedCustomLogoBytes));
      const copiedBytes = accountIconDataUrlBytes(nextIconDataUrl) * selectedCount;
      if (!Number.isSafeInteger(retainedBytes) || retainedBytes + copiedBytes > MAX_VAULT_ACCOUNT_ICON_BYTES) {
        throw new Error(
          `This logo would exceed the encrypted vault's 2 MB custom-logo limit when applied to ${selectedCount} ${selectedCount === 1 ? "account" : "accounts"}.`,
        );
      }
      setChoice("custom");
      setIconBrand("");
      setIconDataUrl(nextIconDataUrl);
    } catch (caught) {
      if (logoRequestRef.current !== request) return;
      setLogoError(caught instanceof Error ? caught.message : "The selected logo could not be processed.");
    } finally {
      if (logoRequestRef.current === request) setLogoBusy(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (unavailable || selectedCount < 1) return;
    setError("");
    setBusy(true);
    try {
      const accepted = await onApply({
        iconBrand: choice === "catalog" ? iconBrand : null,
        iconDataUrl: choice === "custom" ? iconDataUrl : null,
      });
      if (accepted !== false) onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The selected accounts could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  const preview = previewAccount ?? {
    color: "ink" as const,
    letter: "C",
    service: "Coffer",
  };
  const previewBrand = choice === "catalog" && isServiceBrandId(iconBrand)
    ? iconBrand
    : null;
  const selectedOption = choice === "catalog"
    ? brandOptions.find((option) => option.id === iconBrand)
    : undefined;

  return (
    <div className="account-editor-backdrop">
      <button
        type="button"
        className="account-editor-backdrop-dismiss"
        aria-label="Close bulk logo picker"
        onClick={close}
        disabled={unavailable}
        tabIndex={-1}
      />
      <section
        ref={dialogRef}
        className="account-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header className="account-editor-header">
          <div>
            <p className="eyebrow"><span /> ACCOUNT LOGOS</p>
            <h2 id={titleId}>Change selected logos</h2>
            <p id={descriptionId}>Apply one logo choice to {selectedCount} selected {selectedCount === 1 ? "account" : "accounts"}.</p>
          </div>
          <button
            type="button"
            className="account-editor-close"
            aria-label="Close bulk logo picker"
            onClick={close}
            disabled={unavailable}
          >×</button>
        </header>

        <form className="account-editor-form" onSubmit={submit}>
          <div className="account-editor-icon-row">
            <ServiceLogo
              color={preview.color}
              fallback={preview.letter}
              service={preview.service}
              brandId={previewBrand}
              iconDataUrl={choice === "custom" ? iconDataUrl : null}
            />
            <div className="account-editor-icon-picker">
              <label htmlFor={`${pickerId}-search`}>Platform logo</label>
              <input
                ref={searchInputRef}
                id={`${pickerId}-search`}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={suggestedLogoQuery
                  ? `Search logos for ${suggestedLogoQuery}`
                  : "Search local logos"}
                autoComplete="off"
              />
              <small>{choice === "custom"
                ? "Uploaded logo ready for the selected accounts."
                : selectedOption
                  ? `${selectedOption.label}${selectedOption.description ? ` — ${selectedOption.description}` : ""} selected from Coffer's local catalog.`
                  : query.trim()
                    ? visibleCatalogIconCount === 0
                      ? "No catalog logos match. Automatic matching remains selected."
                      : `${visibleCatalogIconCount} matching local ${visibleCatalogIconCount === 1 ? "logo" : "logos"}. Choose one below.`
                    : suggestedLogoQuery
                      ? "Suggested logos are based on the selected accounts' shared platform. Choose one or keep automatic matching."
                      : "Automatic matching keeps each account linked to its own service name."}</small>
            </div>
          </div>

          <fieldset className="account-editor-logo-fieldset" disabled={unavailable}>
            <legend>Choose platform logo</legend>
            <div className="account-editor-custom-logo" aria-busy={logoBusy}>
              <div>
                <strong>Custom logo</strong>
                <small id={`${pickerId}-upload-help`}>PNG, JPEG, or WebP up to 5 MB. Fitted to 128 × 128 and safely checked against the encrypted vault&apos;s logo limit.</small>
              </div>
              <div className="account-editor-custom-logo-actions">
                <label className="account-editor-logo-upload">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept={ACCOUNT_LOGO_ACCEPT}
                    aria-describedby={`${pickerId}-upload-help`}
                    onChange={uploadLogo}
                  />
                  <span>{logoBusy ? "Processing…" : iconDataUrl ? "Replace logo" : "Upload logo"}</span>
                </label>
                {choice === "custom" && (
                  <button type="button" onClick={automatic}>Remove upload</button>
                )}
              </div>
              {logoBusy && <span className="account-editor-logo-status" role="status">Processing logo…</span>}
              {logoError && <span className="account-editor-logo-error" role="alert">{logoError}</span>}
            </div>

            <div className="account-editor-logo-grid">
              <label className="account-editor-logo-option">
                <input
                  type="radio"
                  name={`${pickerId}-choice`}
                  value=""
                  checked={choice === "automatic"}
                  onChange={automatic}
                />
                <ServiceLogo
                  color={preview.color}
                  fallback={preview.letter}
                  service={preview.service}
                  brandId={null}
                  iconDataUrl={null}
                />
                <span><strong>Automatic</strong><small>Match each service</small></span>
              </label>
              {availableOptions.map((option) => (
                <label className="account-editor-logo-option" key={option.id}>
                  <input
                    type="radio"
                    name={`${pickerId}-choice`}
                    value={option.id}
                    checked={choice === "catalog" && iconBrand === option.id}
                    onChange={() => chooseCatalog(option.id)}
                  />
                  <ServiceLogo
                    color={preview.color}
                    fallback={preview.letter}
                    service={preview.service}
                    brandId={isServiceBrandId(option.id) ? option.id : null}
                    iconDataUrl={null}
                  />
                  <span><strong>{option.label}</strong><small>{option.description ?? (option.id === COFFER_INITIALS_BRAND_ID ? "Colored letter tile" : option.id)}</small></span>
                </label>
              ))}
            </div>
          </fieldset>

          {error && <p className="account-editor-error" role="alert">{error}</p>}

          <div className="account-editor-actions">
            <button type="button" onClick={close} disabled={unavailable}>Cancel</button>
            <button type="submit" disabled={unavailable || selectedCount < 1 || (choice === "catalog" && !iconBrand) || (choice === "custom" && !iconDataUrl)}>
              {busy ? "Applying…" : `Apply to ${selectedCount}`}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function BulkLogoPicker(props: BulkLogoPickerProps) {
  const { open, ...dialogProps } = props;
  if (!open) return null;
  return <BulkLogoPickerDialog {...dialogProps} />;
}
