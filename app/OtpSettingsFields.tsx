"use client";

import { MAX_HOTP_COUNTER, type OtpType, type OtpDigits, type TotpAlgorithm } from "../lib/totp";

export type OtpSettingsValues = {
  otpType: OtpType;
  counter: number;
  algorithm: TotpAlgorithm;
  digits: OtpDigits;
  period: number;
};

export default function OtpSettingsFields({ values, onChange }: {
  values: OtpSettingsValues;
  onChange: (values: OtpSettingsValues) => void;
}) {
  const changeType = (otpType: OtpType) => onChange({
    ...values,
    otpType,
    counter: otpType === "hotp" ? values.counter : 0,
    period: otpType === "hotp" ? 30 : values.period,
  });
  return <>
    <label>
      <span>OTP type</span>
      <select value={values.otpType} onChange={(event) => changeType(event.target.value as OtpType)}>
        <option value="totp">TOTP</option><option value="hotp">HOTP</option>
      </select>
    </label>
    <label>
      <span>Algorithm</span>
      <select value={values.algorithm} onChange={(event) => onChange({ ...values, algorithm: event.target.value as TotpAlgorithm })}>
        <option>SHA-1</option><option>SHA-256</option><option>SHA-512</option>
      </select>
    </label>
    <label>
      <span>Digits</span>
      <select value={values.digits} onChange={(event) => onChange({ ...values, digits: Number(event.target.value) as OtpDigits })}>
        <option value="6">6 digits</option><option value="8">8 digits</option>
      </select>
    </label>
    {values.otpType === "hotp" ? <>
      <label><span>Counter</span><input type="number" min={0} max={MAX_HOTP_COUNTER} step={1} value={values.counter} onChange={(event) => onChange({ ...values, counter: Number(event.target.value) })} /></label>
      <p className="field-hint">HOTP changes only when you select Next code. Copying does not advance the counter. Keep the counter synchronized with your service and other devices.</p>
    </> : <label><span>Period</span><input type="number" min={1} max={300} step={1} value={values.period} onChange={(event) => onChange({ ...values, period: Number(event.target.value) })} /></label>}
  </>;
}
