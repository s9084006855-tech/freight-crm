export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function formatPhone(raw?: string): string {
  if (!raw) return "";
  const digits = normalizePhone(raw);
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

export function isValidPhone(raw: string): boolean {
  const d = normalizePhone(raw);
  return d.length === 10 || (d.length === 11 && d[0] === "1");
}

export function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  // Compare last 10 digits to handle +1 prefix variants
  return na.slice(-10) === nb.slice(-10);
}
