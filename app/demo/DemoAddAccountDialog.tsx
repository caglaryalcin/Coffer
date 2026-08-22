"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { TotpAlgorithm } from "../../lib/totp";
import ServiceLogo from "../ServiceLogo";

export type DemoNewAccount = {
  service: string;
  identity: string;
  group: string;
  algorithm: TotpAlgorithm;
  digits: 6 | 8;
  period: number;
};

export type DemoAddAccountDialogProps = {
  open: boolean;
  groups: readonly string[];
  preferredGroup?: string;
  returnFocusTo?: HTMLElement | null;
  onAdd: (account: DemoNewAccount) => boolean | void;
  onClose: () => void;
};

function initials(service: string) {
  const words = service.trim().split(/\s+/u);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : service.slice(0, 2)).slice(0, 3).toUpperCase();
}

function cleanText(value: string, label: string) {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > 256 || /\p{Cc}/u.test(cleaned)) {
    throw new Error(`${label} must be between 1 and 256 characters.`);
  }
  return cleaned;
}

function DemoAddAccountDialogContent({ groups, preferredGroup, returnFocusTo, onAdd, onClose }: Omit<DemoAddAccountDialogProps, "open">) {
  const titleId = useId();
  const [mode, setMode] = useState<"qr" | "link" | "manual">("qr");
  const [service, setService] = useState("GitHub");
  const [identity, setIdentity] = useState("demo.user@coffer.example");
  const [group, setGroup] = useState(() => (
    groups.find((name) => name.trim().toLocaleLowerCase("en") === preferredGroup?.trim().toLocaleLowerCase("en"))
    ?? groups[0]
    ?? "Personal"
  ));
  const [algorithm, setAlgorithm] = useState<TotpAlgorithm>("SHA-1");
  const [digits, setDigits] = useState<6 | 8>(6);
  const [period, setPeriod] = useState(30);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const manualServiceRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    openerRef.current = returnFocusTo
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const firstControl = dialogRef.current?.querySelector<HTMLElement>("[data-autofocus]");
    firstControl?.focus({ preventScroll: true });
    const opener = openerRef.current;
    return () => {
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [returnFocusTo]);

  useEffect(() => {
    if (mode !== "manual") return;
    const frame = window.requestAnimationFrame(() => manualServiceRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [mode]);

  const handleKeyDown = useCallback((event: globalThis.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
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

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      const next = {
        service: cleanText(service, "Service name"),
        identity: cleanText(identity, "Account name"),
        group: cleanText(group, "Group"),
        algorithm,
        digits,
        period,
      } satisfies DemoNewAccount;
      const accepted = onAdd(next);
      if (accepted !== false) onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The sample account could not be added.");
    }
  };

  return (
    <div className="modal-backdrop">
      <button type="button" className="account-editor-backdrop-dismiss" aria-label="Close demo add account dialog" onClick={close} tabIndex={-1} />
      <section ref={dialogRef} className="add-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="modal-head">
          <div><p>NEW AUTHENTICATOR</p><h2 id={titleId}>Add an account</h2></div>
          <button type="button" onClick={close} aria-label="Close demo add account dialog">×</button>
        </div>

        <div className="mode-switch account-input-modes" aria-label="Demo account input method">
          <button type="button" data-autofocus className={mode === "qr" ? "active" : ""} onClick={() => { setMode("qr"); setError(""); }}>Scan QR</button>
          <button type="button" className={mode === "link" ? "active" : ""} onClick={() => { setMode("link"); setError(""); }}>Setup link</button>
          <button type="button" className={mode === "manual" ? "active" : ""} onClick={() => { setMode("manual"); setError(""); }}>Manual entry</button>
        </div>

        {mode === "qr" ? (
          <div className="qr-panel demo-input-preview">
            <div className="scan-motif" aria-hidden="true"><span /><span /><span /></div>
            <h3>Scan or import a QR code</h3>
            <p>The full app can use your camera or read a QR image locally in your browser.</p>
            <div className="demo-preview-actions">
              <button type="button" className="modal-secondary" disabled aria-disabled="true">Use camera</button>
              <button type="button" className="modal-secondary" disabled aria-disabled="true">Import QR image</button>
            </div>
            <p className="demo-disabled-note">Disabled in the public demo. No camera or file picker is connected.</p>
            <button type="button" className="text-button" onClick={() => setMode("manual")}>Add a safe sample manually</button>
          </div>
        ) : mode === "link" ? (
          <div className="link-panel demo-input-preview">
            <div className="scan-motif" aria-hidden="true"><span /><span /><span /></div>
            <h3>Paste your setup link</h3>
            <p>The full app parses <code>otpauth://</code> links only in your browser.</p>
            <label><span>Setup link</span><textarea value="otpauth://totp/Service:account?secret=••••••••" readOnly aria-readonly="true" /></label>
            <button type="button" className="modal-primary" disabled aria-disabled="true">Review account <span>→</span></button>
            <p className="demo-disabled-note">Secret-bearing setup links are read-only in the public demo.</p>
            <button type="button" className="text-button" onClick={() => setMode("manual")}>Add a safe sample manually</button>
          </div>
        ) : (
          <form className="manual-form" onSubmit={submit}>
            <div className="field-row">
              <label>
                <span>Service</span>
                <div className="service-entry-control">
                  <ServiceLogo service={service} fallback={initials(service) || "?"} color="violet" />
                  <input ref={manualServiceRef} className="service-entry-input" value={service} onChange={(event) => setService(event.target.value)} maxLength={256} />
                </div>
              </label>
              <label><span>Group</span><select value={group} onChange={(event) => setGroup(event.target.value)}>{groups.map((name) => <option key={name}>{name}</option>)}</select></label>
            </div>
            <label><span>Account name</span><input value={identity} onChange={(event) => setIdentity(event.target.value)} maxLength={256} autoComplete="off" /></label>
            <div className="demo-manual-secret">
              <span>Base32 secret</span>
              <div className="demo-account-secret-readonly" role="note"><span aria-hidden="true">•••• •••• •••• ••••</span><strong>Public demo vector</strong></div>
              <small>Coffer supplies a known public test secret. Real secrets cannot be entered in this demo.</small>
            </div>
            <div className="field-row advanced-fields">
              <label><span>Algorithm</span><select value={algorithm} onChange={(event) => setAlgorithm(event.target.value as TotpAlgorithm)}><option>SHA-1</option><option>SHA-256</option><option>SHA-512</option></select></label>
              <label><span>Digits</span><select value={digits} onChange={(event) => setDigits(Number(event.target.value) as 6 | 8)}><option value="6">6 digits</option><option value="8">8 digits</option></select></label>
              <label><span>Period</span><select value={period} onChange={(event) => setPeriod(Number(event.target.value))}><option value="30">30 seconds</option><option value="60">60 seconds</option></select></label>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions"><button type="button" className="modal-secondary" onClick={close}>Cancel</button><button className="modal-primary" type="submit">Add sample account <span>→</span></button></div>
          </form>
        )}
      </section>
    </div>
  );
}

export default function DemoAddAccountDialog({ open, ...props }: DemoAddAccountDialogProps) {
  if (!open) return null;
  return <DemoAddAccountDialogContent {...props} />;
}
