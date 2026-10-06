"use client";

import ServiceLogo from "./ServiceLogo";
import type { SavedCustomLogo } from "../lib/custom-logos";

export default function SavedLogoPicker({ logos, selected, onSelect }: {
  logos: readonly SavedCustomLogo[];
  selected: string | null;
  onSelect: (dataUrl: string) => void;
}) {
  if (logos.length === 0) return null;
  return (
    <div className="saved-logo-picker">
      <strong>Saved custom logos</strong>
      <div className="account-editor-logo-grid">
        {logos.map((logo) => (
          <button
            key={logo.dataUrl}
            type="button"
            className="account-editor-logo-option"
            aria-pressed={selected === logo.dataUrl}
            onClick={() => onSelect(logo.dataUrl)}
          >
            <ServiceLogo service={logo.label} fallback="?" color="ink" iconDataUrl={logo.dataUrl} />
            <span data-i18n-ignore>{logo.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
