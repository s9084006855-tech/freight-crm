import type { ContactSummary, ImportRow, ParsedContact } from "../types";
import { normalizePhone } from "./phone";

function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function nameSimilarity(a: string, b: string): number {
  const na = normalizeCompany(a);
  const nb = normalizeCompany(b);
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

export function findDuplicate(
  parsed: ParsedContact,
  existing: ContactSummary[]
): ContactSummary | undefined {
  const parsedPhone = parsed.phone ? normalizePhone(parsed.phone).slice(-10) : "";
  const parsedName = parsed.company_name ?? "";

  // Exact phone match → definite duplicate
  if (parsedPhone) {
    const phoneMatch = existing.find((c) => {
      const cp = c.phone ? normalizePhone(c.phone).slice(-10) : "";
      return cp && cp === parsedPhone;
    });
    if (phoneMatch) return phoneMatch;
  }

  // Fuzzy name match > 0.85
  const nameMatch = existing.find((c) => {
    const sim = nameSimilarity(c.company_name, parsedName);
    return sim >= 0.85;
  });
  return nameMatch;
}

export function classifyRow(
  parsed: ParsedContact,
  existing: ContactSummary[],
  confidence?: number
): Pick<ImportRow, "status" | "issues" | "duplicate_contact_id"> {
  const issues: string[] = [];

  if (!parsed.company_name?.trim()) {
    issues.push("Missing company name");
  }
  if (parsed.phone && !/\d{10}/.test(normalizePhone(parsed.phone))) {
    issues.push("Invalid phone number");
  }
  if (parsed.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.email)) {
    issues.push("Invalid email address");
  }
  if (confidence !== undefined && confidence < 0.7) {
    issues.push(`Low OCR confidence (${Math.round(confidence * 100)}%)`);
  }

  const dup = findDuplicate(parsed, existing);
  if (dup) {
    return { status: "yellow", issues, duplicate_contact_id: dup.id };
  }
  if (issues.some((i) => i.startsWith("Missing") || i.startsWith("Invalid"))) {
    return { status: "red", issues, duplicate_contact_id: undefined };
  }
  return { status: "green", issues, duplicate_contact_id: undefined };
}
