import { defineConfig, globalIgnores } from "eslint/config";
import eslint from "@eslint/js";
import next from "@next/eslint-plugin-next";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  globalIgnores([
    ".next/**",
    "dist/**",
    "out/**",
    "build/**",
    "work/**",
    "next-env.d.ts",
  ]),
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"],
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  next.configs["core-web-vitals"],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.serviceworker,
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    files: ["app/demo/**/*.{ts,tsx}", "lib/demo-vault.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/VaultApp",
                "**/vault-api",
                "**/vault-crypto",
                "**/vault-outbox",
                "**/vault-resume",
                "**/TransferCenter",
                "**/SettingsCenter",
                "**/QrScanner",
                "**/AccountEditor",
                "**/BulkLogoPicker",
                "**/SidebarFooter",
                "**/account-logo",
              ],
              message: "The demo must remain isolated from real vault sessions, persistence, and secret-input surfaces.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "The demo must not make network requests." },
        { name: "XMLHttpRequest", message: "The demo must not make network requests." },
        { name: "WebSocket", message: "The demo must not open network connections." },
        { name: "localStorage", message: "The demo must reset on reload and remain memory-only." },
        { name: "sessionStorage", message: "The demo must reset on reload and remain memory-only." },
        { name: "indexedDB", message: "The demo must not access the real vault's browser databases." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "window", property: "localStorage", message: "The demo must remain memory-only." },
        { object: "window", property: "sessionStorage", message: "The demo must remain memory-only." },
        { object: "window", property: "indexedDB", message: "The demo must not access browser databases." },
        { object: "window", property: "fetch", message: "The demo must not make network requests." },
        { object: "window", property: "XMLHttpRequest", message: "The demo must not make network requests." },
        { object: "window", property: "WebSocket", message: "The demo must not open network connections." },
        { object: "document", property: "cookie", message: "The demo must not access vault cookies." },
        { object: "navigator", property: "sendBeacon", message: "The demo must not make network requests." },
      ],
    },
  },
]);

export default eslintConfig;
