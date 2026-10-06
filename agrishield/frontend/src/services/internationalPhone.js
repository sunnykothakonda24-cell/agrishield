export function normalizeInternationalPhone(countryCallingCode, nationalNumber) {
  const callingCode = String(countryCallingCode || '').replace(/\D/g, '');
  const nationalDigits = String(nationalNumber || '').replace(/\D/g, '');
  if (!/^[1-9]\d{0,2}$/.test(callingCode)) return null;
  const e164 = `+${callingCode}${nationalDigits}`;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}
