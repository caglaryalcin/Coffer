"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

type ExportPasswordDialogProps = {
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
};

export default function ExportPasswordDialog({ onConfirm, onClose }: ExportPasswordDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog?.showModal();
    inputRef.current?.focus();
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      });
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || !password) return;
    submittingRef.current = true;
    setBusy(true);
    setError("");
    const currentPassword = password;
    setPassword("");
    try {
      await onConfirm(currentPassword);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The export could not be created.");
    } finally {
      submittingRef.current = false;
      setBusy(false);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  return (
    <dialog ref={dialogRef} className="account-editor export-password-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); if (!submittingRef.current) onClose(); }}>
      <header className="account-editor-header">
        <h2 id={titleId}>Confirm export</h2>
        <button type="button" className="account-editor-close" aria-label="Cancel export" onClick={onClose} disabled={busy}>×</button>
      </header>
      <form className="account-editor-form" onSubmit={submit} aria-busy={busy}>
        <p id={descriptionId}>Enter your current Coffer account password to download this export. This is separate from the backup passphrase.</p>
        <label className="account-editor-secret">
          <span>Current account password</span>
          <input ref={inputRef} type="password" value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} autoComplete="current-password" required disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} />
        </label>
        {error && <p id={errorId} className="account-editor-error" role="alert">{error}</p>}
        <div className="account-editor-actions">
          <button type="button" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" disabled={busy || !password}>{busy ? "Preparing export…" : "Verify and export"}</button>
        </div>
      </form>
    </dialog>
  );
}
