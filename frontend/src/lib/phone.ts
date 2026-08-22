export function normalizeKenyanPhone(value: string) {
  const compact = value.trim().replace(/[\s()-]/g, "");
  if (compact.startsWith("0")) return `+254${compact.slice(1)}`;
  if (compact.startsWith("254")) return `+${compact}`;
  return compact;
}

export function isKenyanPhone(value: string) {
  return /^\+254\d{9}$/.test(normalizeKenyanPhone(value));
}
