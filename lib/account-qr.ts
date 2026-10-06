import qrcode from "qrcode-generator";
import { createOtpAuthUri, parseOtpAuthUri, type ParsedOtpAuth } from "./totp";

export function createAccountQr(account: ParsedOtpAuth) {
  // Validate all edited settings before exposing an importable credential.
  const uri = createOtpAuthUri(account);
  parseOtpAuthUri(uri);
  const qr = qrcode(0, "M");
  qr.addData(uri, "Byte");
  qr.make();
  const modules = qr.getModuleCount();
  const quietZone = 4;
  const paths: string[] = [];
  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (qr.isDark(row, column)) {
        paths.push(`M${column + quietZone},${row + quietZone}h1v1h-1z`);
      }
    }
  }
  return { size: modules + quietZone * 2, path: paths.join("") };
}
