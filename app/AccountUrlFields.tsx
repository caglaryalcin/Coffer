"use client";

import { useId, useState } from "react";
import { MAX_ACCOUNT_URL_LENGTH, MAX_ACCOUNT_URLS } from "../lib/vault-model";

export type AccountUrlFieldsProps = {
  urls: readonly string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
};

export default function AccountUrlFields({ urls, onChange, disabled = false }: AccountUrlFieldsProps) {
  const helpId = useId();
  const [helpOpen, setHelpOpen] = useState(false);
  const values = urls.length > 0 ? urls : [""];

  const changeUrl = (index: number, value: string) => {
    const next = [...values];
    next[index] = value;
    onChange(next);
  };

  const removeUrl = (index: number) => {
    const next = values.filter((_, valueIndex) => valueIndex !== index);
    onChange(next.length > 0 ? next : [""]);
  };

  return (
    <div className="account-url-fields account-editor-wide-field">
      <div className="account-url-label">
        <span>Website URLs</span>
        <span className="account-url-help-wrap">
          <button
            type="button"
            className="account-url-help"
            aria-label="About website URLs"
            aria-expanded={helpOpen}
            aria-controls={helpId}
            onClick={() => setHelpOpen((open) => !open)}
          >?</button>
          {helpOpen && (
            <span id={helpId} className="account-url-popover" role="note">
              Only required if you use the Coffer extension.
            </span>
          )}
        </span>
      </div>

      <div className="account-url-list">
        {values.map((url, index) => (
          <div className="account-url-row" key={index}>
            <input
              type="text"
              value={url}
              onChange={(event) => changeUrl(index, event.target.value)}
              placeholder="https://example.com"
              maxLength={MAX_ACCOUNT_URL_LENGTH}
              autoComplete="url"
              inputMode="url"
              aria-label={`Website URL ${index + 1}`}
              disabled={disabled}
            />
            {(values.length > 1 || url.length > 0) && (
              <button
                type="button"
                className="account-url-remove"
                onClick={() => removeUrl(index)}
                aria-label={`Remove website URL ${index + 1}`}
                disabled={disabled}
              >×</button>
            )}
          </div>
        ))}
      </div>

      {values.length < MAX_ACCOUNT_URLS && (
        <button
          type="button"
          className="account-url-add"
          onClick={() => onChange([...values, ""])}
          disabled={disabled}
        >+ Add another URL</button>
      )}
    </div>
  );
}
