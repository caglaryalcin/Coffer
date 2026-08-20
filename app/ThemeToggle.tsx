"use client";

import Image from "next/image";
import type { VaultTheme } from "../lib/vault-model";

export type ThemeToggleProps = {
  theme: VaultTheme;
  onToggle: () => void;
};

export default function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const themeAction =
    theme === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onToggle}
      aria-label={themeAction}
      title={themeAction}
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
