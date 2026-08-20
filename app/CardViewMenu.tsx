"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

export const CARD_VIEW_STORAGE_KEY = "coffer:card-view:v1";
export const CARD_VIEW_VALUES = ["default", "compact", "grid"] as const;
export type CardView = (typeof CARD_VIEW_VALUES)[number];

type CardViewStorage = Pick<Storage, "getItem" | "setItem">;

const CARD_VIEW_OPTIONS: readonly {
  value: CardView;
  label: string;
  description: string;
}[] = [
  { value: "default", label: "Default", description: "Balanced cards" },
  { value: "compact", label: "Compact", description: "Condensed horizontal cards" },
  { value: "grid", label: "Grid", description: "More cards per row" },
];

export function parseCardView(value: unknown): CardView {
  return CARD_VIEW_VALUES.includes(value as CardView) ? value as CardView : "default";
}

function browserStorage(): CardViewStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readCardViewPreference(storage: CardViewStorage | null = browserStorage()): CardView {
  try {
    return parseCardView(storage?.getItem(CARD_VIEW_STORAGE_KEY));
  } catch {
    return "default";
  }
}

export function writeCardViewPreference(
  value: CardView,
  storage: CardViewStorage | null = browserStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(CARD_VIEW_STORAGE_KEY, value);
    return true;
  } catch {
    return false;
  }
}

function CardViewGlyph({ value }: { value: CardView }) {
  return (
    <span className={`card-view-glyph card-view-glyph-${value}`} aria-hidden="true">
      <i /><i /><i /><i /><i /><i />
    </span>
  );
}

type CardViewMenuProps = {
  value: CardView;
  onChange: (value: CardView) => void;
  onOpen?: () => void;
};

export default function CardViewMenu({ value, onChange, onOpen }: CardViewMenuProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const currentOption = CARD_VIEW_OPTIONS.find((option) => option.value === value) ?? CARD_VIEW_OPTIONS[0];
  const selectedIndex = Math.max(0, CARD_VIEW_OPTIONS.findIndex((option) => option.value === value));

  useEffect(() => {
    if (!open) return;
    const animationFrame = window.requestAnimationFrame(() => optionRefs.current[focusedIndex]?.focus());
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

  const openMenu = () => {
    if (open) {
      setOpen(false);
      return;
    }
    onOpen?.();
    setFocusedIndex(selectedIndex);
    setOpen(true);
  };

  const selectView = (nextView: CardView) => {
    onChange(nextView);
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const moveOptionFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown") nextIndex = (index + 1) % CARD_VIEW_OPTIONS.length;
    if (event.key === "ArrowUp") nextIndex = (index - 1 + CARD_VIEW_OPTIONS.length) % CARD_VIEW_OPTIONS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = CARD_VIEW_OPTIONS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    setFocusedIndex(nextIndex);
    optionRefs.current[nextIndex]?.focus();
  };

  return (
    <div className="card-view-picker" ref={wrapperRef}>
      <button
        ref={triggerRef}
        type="button"
        className="card-view-trigger"
        aria-label={`Card view: ${currentOption.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={`Card view: ${currentOption.label}`}
        onClick={openMenu}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          if (!open) {
            onOpen?.();
            setFocusedIndex(selectedIndex);
          } else {
            const nextIndex = event.key === "ArrowDown"
              ? (focusedIndex + 1) % CARD_VIEW_OPTIONS.length
              : (focusedIndex - 1 + CARD_VIEW_OPTIONS.length) % CARD_VIEW_OPTIONS.length;
            setFocusedIndex(nextIndex);
            optionRefs.current[nextIndex]?.focus();
          }
          setOpen(true);
        }}
      >
        <CardViewGlyph value={value} />
      </button>

      {open && (
        <div className="card-view-menu" id={menuId} role="menu" aria-label="Card view">
          {CARD_VIEW_OPTIONS.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              className="card-view-option"
              role="menuitemradio"
              aria-checked={option.value === value}
              tabIndex={index === focusedIndex ? 0 : -1}
              onClick={() => selectView(option.value)}
              onFocus={() => setFocusedIndex(index)}
              onKeyDown={(event) => moveOptionFocus(event, index)}
            >
              <CardViewGlyph value={option.value} />
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
              <span className="card-view-option-check" aria-hidden="true">✓</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
