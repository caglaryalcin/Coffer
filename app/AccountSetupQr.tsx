"use client";

import { useMemo } from "react";
import { createAccountQr } from "../lib/account-qr";
import type { ParsedOtpAuth } from "../lib/totp";

export default function AccountSetupQr({ issuer, account, secret, algorithm, digits, period }: ParsedOtpAuth) {
  const qr = useMemo(() => {
    try {
      return createAccountQr({ issuer, account, secret, algorithm, digits, period });
    } catch {
      return null;
    }
  }, [issuer, account, secret, algorithm, digits, period]);
  return qr ? (
    <div className="account-setup-qr">
      <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="Account import QR code" shapeRendering="crispEdges">
        <rect width={qr.size} height={qr.size} fill="#fff" />
        <path d={qr.path} fill="#000" />
      </svg>
      <p>Scan with another authenticator to import this account. This QR contains your secret key; keep it private.</p>
    </div>
  ) : <p className="account-editor-secret-test-feedback">Enter a valid service, account name, secret, and TOTP settings to display the import QR.</p>;
}
