"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { accountEditorReturnFocusTarget } from "../lib/account-editor";
import { MAX_ACCOUNT_URLS, parseAccountUrls } from "../lib/vault-model";

export type BulkUrlEditorProps = {
  open: boolean;
  selectedCount: number;
  returnFocusTo?: HTMLElement | null;
  onApply: (urls: string[]) => boolean | void | Promise<boolean | void>;
  onClose: () => void;
};

function BulkUrlEditorDialog({
  selectedCount,
  returnFocusTo,
  onApply,
  onClose,
}: Omit<BulkUrlEditorProps, "open">) {
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useEffect(() => {
    openerRef.current = accountEditorReturnFocusTarget(
      returnFocusTo,
      document.activeElement instanceof HTMLElement ? document.activeElement : null,
    );
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus({ preventScroll: true });
    const opener = openerRef.current;
    return () => {
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, [returnFocusTo]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [busy, close]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      const entries = value.split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
      if (entries.length === 0) throw new Error("Add at least one website URL.");
      const urls = parseAccountUrls(entries, "Website URLs");
      setBusy(true);
      const accepted = await onApply(urls);
      if (accepted !== false) onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The website URLs could not be added.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-editor-backdrop">
      <button
        type="button"
        className="account-editor-backdrop-dismiss"
        aria-label="Close bulk URL editor"
        onClick={close}
        disabled={busy}
        tabIndex={-1}
      />
      <section
        ref={dialogRef}
        className="account-editor bulk-url-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header className="account-editor-header">
          <div>
            <p className="eyebrow"><span /> WEBSITE URLS</p>
            <h2 id={titleId}>Add URLs to selected accounts</h2>
            <p id={descriptionId}>Existing URLs are kept for all {selectedCount} selected {selectedCount === 1 ? "account" : "accounts"}.</p>
          </div>
          <button type="button" className="account-editor-close" aria-label="Close bulk URL editor" onClick={close} disabled={busy}>×</button>
        </header>
        <form className="account-editor-form" onSubmit={submit}>
          <label className="bulk-url-input" htmlFor={inputId}>
            <span>Website URLs</span>
            <textarea
              ref={inputRef}
              id={inputId}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={"https://example.com\nhttps://login.example.com"}
              rows={6}
              spellCheck={false}
              disabled={busy}
            />
            <small>Add one URL per line, up to {MAX_ACCOUNT_URLS}. Only required if you use the Coffer extension.</small>
          </label>
          {error && <p className="account-editor-error" role="alert">{error}</p>}
          <div className="account-editor-actions">
            <button type="button" onClick={close} disabled={busy}>Cancel</button>
            <button type="submit" disabled={busy || selectedCount < 1 || !value.trim()}>{busy ? "Adding…" : `Add to ${selectedCount}`}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default function BulkUrlEditor(props: BulkUrlEditorProps) {
  const { open, ...dialogProps } = props;
  if (!open) return null;
  return <BulkUrlEditorDialog {...dialogProps} />;
}
