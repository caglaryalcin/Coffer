"use client";

import Image from "next/image";
import type { VaultTheme } from "../lib/vault-model";

export type ThemeToggleProps = {
  theme: VaultTheme;
  onToggle: () => void;
  disabled?: boolean;
  disabledReason?: string;
};

export default function ThemeToggle({
  theme,
  onToggle,
  disabled = false,
  disabledReason,
}: ThemeToggleProps) {
  const themeAction =
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  const accessibleLabel = disabled && disabledReason ? disabledReason : themeAction;

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <Image
        src={theme === "dark" ? "/theme-sun.png" : "/theme-moon.png"}
        alt=""
        aria-hidden="true"
        className="theme-toggle-icon"
        width={24}
        height={24}
      />
    </button>
  );
}
