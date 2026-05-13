import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { ParsedContact } from "../types";

export type RawRow = Record<string, string>;

// ── CSV / TSV ─────────────────────────────────────────────────────────

export function parseCsv(content: string): RawRow[] {
  const result = Papa.parse<RawRow>(content, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  });
  return result.data;
}

// ── XLSX / XLS ────────────────────────────────────────────────────────

export function parseXlsx(buffer: ArrayBuffer): RawRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<RawRow>(ws, {
    defval: "",
    raw: false,
  });
  return rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k.trim(), String(v ?? "").trim()])
    )
  );
}

// ── Column mapping ─────────────────────────────────────────────────────

// Maps a raw column name to a ParsedContact field key.
// Returns the canonical field name or null if no match.

const FIELD_ALIASES: Record<string, keyof ParsedContact> = {
  // company_name
  company: "company_name",
  company_name: "company_name",
  "company name": "company_name",
  shipper: "company_name",
  receiver: "company_name",
  "shipper/receiver": "company_name",
  "business name": "company_name",
  name: "company_name",
  firm: "company_name",

  // phone
  phone: "phone",
  telephone: "phone",
  tel: "phone",
  "main phone": "phone",
  "phone number": "phone",
  "main #": "phone",
  "office phone": "phone",

  // fax
  fax: "fax",
  "fax number": "fax",
  "fax #": "fax",

  // email
  email: "email",
  "e-mail": "email",
  "email address": "email",

  // website
  website: "website",
  web: "website",
  url: "website",
  "web site": "website",

  // address
  street: "street",
  address: "street",
  "street address": "street",
  addr: "street",
  "address 1": "street",

  // city
  city: "city",
  town: "city",

  // state
  state: "state",
  st: "state",
  province: "state",

  // zip
  zip: "zip",
  "zip code": "zip",
  zipcode: "zip",
  postal: "zip",
  "postal code": "zip",

  // roles
  type: "roles",
  role: "roles",
  roles: "roles",
  "company type": "roles",
  category: "roles",

  // commodities
  commodity: "commodities",
  commodities: "commodities",
  product: "commodities",
  products: "commodities",
  "commodity type": "commodities",

  // contact name
  contact: "contact_name",
  "contact name": "contact_name",
  "contact person": "contact_name",
  person: "contact_name",
  "first name": "contact_name",
  firstname: "contact_name",

  // contact title
  title: "contact_title",
  "contact title": "contact_title",
  position: "contact_title",

  // contact phone
  "contact phone": "contact_phone",
  "cell phone": "contact_phone",
  cell: "contact_phone",
  mobile: "contact_phone",
  direct: "contact_phone",
  "direct phone": "contact_phone",

  // contact email
  "contact email": "contact_email",
  "direct email": "contact_email",

  // bbid
  bbid: "bbid",
  "bb id": "bbid",
  "bb #": "bbid",
  "bluebook id": "bbid",

  // notes
  notes: "notes",
  note: "notes",
  comments: "notes",
  comment: "notes",
  memo: "notes",
};

export function guessMapping(headers: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const h of headers) {
    const normalized = h.toLowerCase().trim();
    const field = FIELD_ALIASES[normalized];
    if (field) result[h] = field;
  }
  return result;
}

// ── Apply mapping ──────────────────────────────────────────────────────

export function applyMapping(
  row: RawRow,
  mapping: Record<string, string>
): ParsedContact {
  const parsed: ParsedContact = {};
  for (const [col, field] of Object.entries(mapping)) {
    const value = row[col]?.trim();
    if (!value) continue;
    const key = field as keyof ParsedContact;
    if (parsed[key]) {
      // Append if already set (e.g., "first name" + "last name" both mapped to contact_name)
      (parsed[key] as string) += " " + value;
    } else {
      (parsed as Record<string, string>)[key] = value;
    }
  }
  return parsed;
}

// ── Detect source type from file extension ─────────────────────────────

export function detectSourceType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "csv" || ext === "tsv" || ext === "txt") return "csv";
  if (ext === "xlsx" || ext === "xls") return "xlsx";
  if (ext === "pdf") return "pdf";
  return "csv";
}

// ── Parse file into raw rows ───────────────────────────────────────────

export async function parseFile(file: File): Promise<{ rows: RawRow[]; headers: string[] }> {
  const sourceType = detectSourceType(file.name);

  if (sourceType === "xlsx") {
    const buf = await file.arrayBuffer();
    const rows = parseXlsx(buf);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
    return { rows, headers };
  }

  // CSV / TSV / TXT
  const text = await file.text();
  const rows = parseCsv(text);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { rows, headers };
}
