"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { VaultGroupColor, VaultGroupIcon } from "../lib/vault-model";

export type GroupCustomizationValue = {
  name: string;
  icon: VaultGroupIcon;
  color: VaultGroupColor;
};

export type GroupCustomizationDialogProps = {
  open: boolean;
  group: GroupCustomizationValue | null;
  mode?: "create" | "edit";
  existingNames: readonly string[];
  busy?: boolean;
  returnFocusTo?: HTMLElement | null;
  onCancel: () => void;
  onSave: (value: GroupCustomizationValue) => boolean | void | Promise<boolean | void>;
  onDelete?: () => boolean | void | Promise<boolean | void>;
  deleteDisabledReason?: string;
};

export const GROUP_ICON_OPTIONS = [
  { value: "dot", label: "Dot" },
  { value: "folder", label: "Folder" },
  { value: "briefcase", label: "Briefcase" },
  { value: "person", label: "Person" },
  { value: "shield", label: "Shield" },
  { value: "star", label: "Star" },
  { value: "home", label: "Home" },
  { value: "code", label: "Code" },
  { value: "work", label: "Work" },
  { value: "personal", label: "Personal" },
  { value: "shopping", label: "Shopping" },
  { value: "finance", label: "Finance" },
  { value: "travel", label: "Travel" },
  { value: "education", label: "Education" },
  { value: "health", label: "Health" },
  { value: "social", label: "Social" },
] as const satisfies readonly { value: VaultGroupIcon; label: string }[];

export const GROUP_COLOR_OPTIONS = [
  { value: "rose", label: "Rose" },
  { value: "amber", label: "Amber" },
  { value: "lime", label: "Lime" },
  { value: "emerald", label: "Emerald" },
  { value: "sky", label: "Sky" },
  { value: "blue", label: "Blue" },
  { value: "violet", label: "Violet" },
  { value: "slate", label: "Slate" },
] as const satisfies readonly { value: VaultGroupColor; label: string }[];

const CONTROL_CHARACTER = /\p{Cc}/u;

function comparableName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
}

export function validateGroupCustomizationName(
  value: string,
  currentName: string,
  existingNames: readonly string[],
) {
  if (CONTROL_CHARACTER.test(value)) {
    throw new Error("Group names cannot contain control characters.");
  }

  const name = value.trim();
  if (!name) throw new Error("Enter a group name.");
  if (name.length > 48) throw new Error("Group names can be at most 48 characters.");

  const key = comparableName(name);
  if (key === "all") throw new Error('"All" is reserved and cannot be used as a group name.');

  const currentKey = comparableName(currentName);
  const duplicate = existingNames.some((existingName) => {
    const existingKey = comparableName(existingName);
    return existingKey === key && existingKey !== currentKey;
  });
  if (duplicate) throw new Error("A group with this name already exists.");

  return name;
}

function focusableElements(dialog: HTMLElement | null) {
  if (!dialog) return [];
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

function GroupCustomizationDialogContent({
  group,
  mode = "edit",
  existingNames,
  busy = false,
  returnFocusTo,
  onCancel,
  onSave,
  onDelete,
  deleteDisabledReason,
}: Omit<GroupCustomizationDialogProps, "open" | "group"> & { group: GroupCustomizationValue }) {
  const titleId = useId();
  const descriptionId = useId();
  const nameId = useId();
  const errorId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const submitInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const [name, setName] = useState(group.name);
  const [icon, setIcon] = useState<VaultGroupIcon>(group.icon);
  const [color, setColor] = useState<VaultGroupColor>(group.color);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");
  const isBusy = busy || saving || deleting;

  useEffect(() => {
    mountedRef.current = true;
    const opener = returnFocusTo === undefined
      ? document.activeElement instanceof HTMLElement ? document.activeElement : null
      : returnFocusTo;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    if (nameInputRef.current?.disabled) {
      dialogRef.current?.focus({ preventScroll: true });
    } else {
      nameInputRef.current?.focus({ preventScroll: true });
      nameInputRef.current?.select();
    }

    return () => {
      mountedRef.current = false;
      submitInFlightRef.current = false;
      document.body.style.overflow = previousOverflow;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [returnFocusTo]);

  const close = useCallback(() => {
    if (!isBusy) onCancel();
  }, [isBusy, onCancel]);

  const handleKeyDown = useCallback((event: globalThis.KeyboardEvent) => {
    if (event.key === "Escape") {
      if (!isBusy) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = focusableElements(dialogRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (!dialogRef.current?.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }, [close, isBusy]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy || submitInFlightRef.current) return;

    let normalizedName: string;
    try {
      normalizedName = validateGroupCustomizationName(name, group.name, existingNames);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Enter a valid group name.");
      nameInputRef.current?.focus({ preventScroll: true });
      return;
    }

    setError("");
    setSaving(true);
    submitInFlightRef.current = true;
    try {
      const accepted = await onSave({ name: normalizedName, icon, color });
      if (mountedRef.current && accepted === false) {
        setError("The group could not be saved. Check the name and try again.");
      }
    } catch (caught) {
      if (mountedRef.current) {
        setError(caught instanceof Error ? caught.message : "The group could not be saved.");
      }
    } finally {
      submitInFlightRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  const deleteGroup = async () => {
    if (!onDelete || deleteDisabledReason || isBusy || submitInFlightRef.current) return;
    if (!confirmingDelete) {
      setError("");
      setConfirmingDelete(true);
      return;
    }

    setError("");
    setDeleting(true);
    submitInFlightRef.current = true;
    try {
      const accepted = await onDelete();
      if (mountedRef.current && accepted === false) {
        setError("The group could not be deleted.");
        setConfirmingDelete(false);
      }
    } catch (caught) {
      if (mountedRef.current) {
        setError(caught instanceof Error ? caught.message : "The group could not be deleted.");
        setConfirmingDelete(false);
      }
    } finally {
      submitInFlightRef.current = false;
      if (mountedRef.current) setDeleting(false);
    }
  };

  return (
    <div className="group-customization-backdrop">
      <button
        type="button"
        className="group-customization-backdrop-dismiss"
        aria-label="Close group customization"
        onClick={close}
        disabled={isBusy}
        tabIndex={-1}
      />
      <section
        ref={dialogRef}
        className="group-customization-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <header className="group-customization-header">
          <div>
            <p className="eyebrow"><span /> {mode === "create" ? "NEW GROUP" : "GROUP DETAILS"}</p>
            <h2 id={titleId}>{mode === "create" ? "Create group" : "Customize group"}</h2>
            <p id={descriptionId}>{mode === "create"
              ? "Name this empty group and choose how it appears in the sidebar."
              : "Rename this group and choose how it appears in the sidebar."}</p>
          </div>
          <button
            type="button"
            className="group-customization-close"
            aria-label="Close group customization"
            onClick={close}
            disabled={isBusy}
          >
            ×
          </button>
        </header>

        <form className="group-customization-form" onSubmit={save} noValidate>
          <div className="group-customization-name-row">
            <span
              className="group-customization-preview"
              data-icon={icon}
              data-color={color}
              aria-hidden="true"
            />
            <label htmlFor={nameId}>
              <span>Group name</span>
              <input
                ref={nameInputRef}
                id={nameId}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (error) setError("");
                }}
                required
                maxLength={48}
                autoComplete="off"
                placeholder={mode === "create" ? "e.g. Clients" : undefined}
                disabled={isBusy}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? errorId : undefined}
              />
            </label>
          </div>

          <fieldset className="group-customization-icon-fieldset" disabled={isBusy}>
            <legend>Icon</legend>
            <div className="group-customization-icon-grid">
              {GROUP_ICON_OPTIONS.map((option) => (
                <label className="group-customization-icon-option" key={option.value}>
                  <input
                    type="radio"
                    name="group-icon"
                    value={option.value}
                    checked={icon === option.value}
                    onChange={() => setIcon(option.value)}
                  />
                  <span
                    className="group-customization-option-icon"
                    data-icon={option.value}
                    data-color={color}
                    aria-hidden="true"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="group-customization-color-fieldset" disabled={isBusy}>
            <legend>Color</legend>
            <div className="group-customization-color-grid">
              {GROUP_COLOR_OPTIONS.map((option) => (
                <label className="group-customization-color-option" key={option.value}>
                  <input
                    type="radio"
                    name="group-color"
                    value={option.value}
                    checked={color === option.value}
                    onChange={() => setColor(option.value)}
                  />
                  <span className="group-customization-color-swatch" data-color={option.value} aria-hidden="true" />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {onDelete && (
            <p className={`group-customization-delete-note ${confirmingDelete ? "confirming" : ""}`}>
              {deleteDisabledReason
                ? deleteDisabledReason
                : confirmingDelete
                  ? "Delete this empty group? This cannot be undone. Accounts are never deleted with a group."
                  : "This group is empty. Delete it when you no longer need it."}
            </p>
          )}

          {error && <p id={errorId} className="group-customization-error" role="alert">{error}</p>}

          <footer className="group-customization-actions">
            {onDelete && (
              <button
                type="button"
                className="group-customization-delete-action"
                onClick={() => void deleteGroup()}
                disabled={isBusy || Boolean(deleteDisabledReason)}
              >{deleting ? "Deleting…" : confirmingDelete ? "Confirm delete" : "Delete group"}</button>
            )}
            <button type="button" onClick={close} disabled={isBusy}>Cancel</button>
            <button type="submit" disabled={isBusy}>{saving || busy ? "Saving…" : mode === "create" ? "Create group" : "Save changes"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export default function GroupCustomizationDialog({
  open,
  group,
  mode = "edit",
  ...props
}: GroupCustomizationDialogProps) {
  if (!open || !group) return null;
  return (
    <GroupCustomizationDialogContent
      key={`${mode}\u0000${group.name}\u0000${group.icon}\u0000${group.color}`}
      group={group}
      mode={mode}
      {...props}
    />
  );
}
