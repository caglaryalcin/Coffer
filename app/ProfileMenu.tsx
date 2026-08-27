"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { VaultProfile } from "../lib/vault-model";
import OverflowingIdentity from "./OverflowingIdentity";

export type ProfileMenuItem = {
  id: string;
  label: string;
};

export type ProfileMenuProps = {
  profile: VaultProfile;
  items: readonly ProfileMenuItem[];
  onSelect: (id: string) => void;
  onOpen?: () => void;
  title?: string;
};

function profileInitials(name: string) {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}` : parts[0]?.slice(0, 2) || "C").toUpperCase();
}

export default function ProfileMenu({
  profile,
  items,
  onSelect,
  onOpen,
  title = "Open profile menu",
}: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const animationFrame = window.requestAnimationFrame(() => itemRefs.current[focusedIndex]?.focus());
    const closeOutside = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnOutsideFocus = (event: FocusEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOnOutsideFocus);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOnOutsideFocus);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [focusedIndex, open]);

  const openMenu = (index = 0) => {
    onOpen?.();
    setFocusedIndex(index);
    setOpen(true);
  };

  const selectItem = (id: string) => {
    setOpen(false);
    onSelect(id);
  };

  const moveFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (index + 1) % items.length;
    if (event.key === "ArrowUp") nextIndex = (index - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setFocusedIndex(nextIndex);
    itemRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="profile-menu-wrap" ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className="profile-row header-profile"
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={title}
        onClick={() => {
          if (open) setOpen(false);
          else openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (!open) openMenu(event.key === "ArrowDown" ? 0 : items.length - 1);
        }}
      >
        <span className={`avatar${profile.avatarDataUrl ? " has-photo" : ""}`}>
          {profile.avatarDataUrl
            ? <img src={profile.avatarDataUrl} alt="" /> // eslint-disable-line @next/next/no-img-element -- encrypted data URLs cannot use the image optimizer
            : profileInitials(profile.name)}
        </span>
        <span className="profile-copy" data-i18n-ignore>
          <OverflowingIdentity as="span" text={profile.name} className="profile-name" pixelsPerSecond={22} />
          <OverflowingIdentity as="span" text={profile.email} className="profile-email" pixelsPerSecond={22} />
        </span>
      </button>

      {open && (
        <div className="profile-menu" id={menuId} role="menu" aria-label="Settings sections">
          {items.map((item, index) => (
            <button
              key={item.id}
              ref={(element) => { itemRefs.current[index] = element; }}
              type="button"
              role="menuitem"
              tabIndex={index === focusedIndex ? 0 : -1}
              onClick={() => selectItem(item.id)}
              onFocus={() => setFocusedIndex(index)}
              onKeyDown={(event) => moveFocus(event, index)}
            >{item.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
