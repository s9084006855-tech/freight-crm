import type { ParsedContact } from "../types";

// ── Regex extractors ───────────────────────────────────────────────────

const PHONE_RE =
  /(?:(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g;

const FAX_RE =
  /(?:fax|fx|facsimile)[:\s]*([+\d()\s.-]{7,20})/i;

const EMAIL_RE = /\b[^\s@]+@[^\s@]+\.[^\s@]{2,}\b/g;

const URL_RE =
  /(?:https?:\/\/|www\.)[\w.-]+(?:\.[\w]{2,})+(?:\/[^\s]*)*/gi;

const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/;

const STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC",
]);

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY",
};

// ── Title / role heuristics ────────────────────────────────────────────

const TITLE_KEYWORDS = [
  "traffic manager", "logistics manager", "transportation manager",
  "operations manager", "purchasing manager", "procurement manager",
  "warehouse manager", "shipping manager", "receiving manager",
  "dispatcher", "coordinator", "supervisor", "director", "vp", "president",
  "owner", "ceo", "coo", "controller",
];

const ROLE_KEYWORDS: Record<string, string> = {
  shipper: "shipper",
  "cold storage": "cold storage",
  "produce warehouse": "shipper",
  distributor: "distributor",
  wholesaler: "distributor",
  retailer: "receiver",
  receiver: "receiver",
  terminal: "terminal market",
  grower: "grower/shipper",
  "grower-shipper": "grower/shipper",
  broker: "broker",
};

const COMMODITY_KEYWORDS = [
  "produce", "fruit", "vegetable", "vegetables", "tomatoes", "tomato",
  "lettuce", "berries", "citrus", "avocado", "avocados", "peppers",
  "onions", "potatoes", "grapes", "strawberries", "apples", "pears",
  "peaches", "plums", "cherries", "bananas", "mangoes", "melon", "melons",
  "watermelon", "cantaloupe", "broccoli", "cauliflower", "spinach", "kale",
  "mushrooms", "garlic", "corn", "cucumber", "squash",
];

// ── Main parser ────────────────────────────────────────────────────────

export function parsePastedText(raw: string): ParsedContact {
  const parsed: ParsedContact = {};
  const lines = raw
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const fullText = raw;
  const lower = fullText.toLowerCase();

  // ── Phones ────────────────────────────────────────────────────────
  const allPhones = fullText.match(PHONE_RE) ?? [];
  const uniquePhones = [...new Set(allPhones.map((p) => p.trim()))];

  // Detect fax explicitly labeled
  const faxMatch = fullText.match(FAX_RE);
  let faxPhone: string | null = null;
  if (faxMatch) {
    faxPhone = faxMatch[1].trim();
    parsed.fax = faxPhone;
  }

  const mainPhones = uniquePhones.filter(
    (p) => !faxPhone || !p.includes(faxPhone.replace(/\D/g, "").slice(-7))
  );
  if (mainPhones[0]) parsed.phone = mainPhones[0];
  if (mainPhones[1]) parsed.contact_phone = mainPhones[1];

  // ── Emails ────────────────────────────────────────────────────────
  const emails = fullText.match(EMAIL_RE) ?? [];
  if (emails[0]) parsed.email = emails[0];
  if (emails[1]) parsed.contact_email = emails[1];

  // ── Website ───────────────────────────────────────────────────────
  const urlMatches = fullText.match(URL_RE) ?? [];
  const website = urlMatches.find((u) => !u.includes("@"));
  if (website) parsed.website = website;

  // ── Location ──────────────────────────────────────────────────────
  const zipMatch = fullText.match(ZIP_RE);
  if (zipMatch) parsed.zip = zipMatch[1];

  // Try to find "City, ST" pattern
  const cityStateRe = /([A-Za-z\s]+),\s*([A-Z]{2})\b/g;
  let csMatch: RegExpExecArray | null;
  while ((csMatch = cityStateRe.exec(fullText)) !== null) {
    const potentialCity = csMatch[1].trim();
    const potentialState = csMatch[2].trim().toUpperCase();
    if (STATE_CODES.has(potentialState) && potentialCity.length > 1) {
      parsed.city = potentialCity;
      parsed.state = potentialState;
      break;
    }
  }

  // Try full state names
  if (!parsed.state) {
    for (const [stateName, code] of Object.entries(STATE_NAMES)) {
      if (lower.includes(stateName)) {
        parsed.state = code;
        break;
      }
    }
  }

  // ── Street address ────────────────────────────────────────────────
  const streetRe = /\b\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Ave|Blvd|Rd|Dr|Ln|Way|Pkwy|Hwy|Ct|Pl|Cir|Loop|Trail|Ter|Row)\b\.?/i;
  const streetMatch = fullText.match(streetRe);
  if (streetMatch) parsed.street = streetMatch[0];

  // ── Company name ──────────────────────────────────────────────────
  // Heuristic: first line that is not a phone/email/address/URL tends to be company name
  for (const line of lines) {
    if (EMAIL_RE.test(line) || PHONE_RE.test(line) || URL_RE.test(line)) continue;
    if (/^\d/.test(line) && line.split(/\s+/).length < 4) continue; // skip address lines
    if (line.length < 3 || line.length > 80) continue;
    // Avoid picking up titles / people names as company
    const isTitle = TITLE_KEYWORDS.some((t) => line.toLowerCase().includes(t));
    if (isTitle) continue;
    parsed.company_name = line;
    break;
  }

  // ── Contact name ──────────────────────────────────────────────────
  // Look for lines that look like a person's name (2–4 capitalized words, no digits)
  const nameRe = /^([A-Z][a-z'-]+)(?:\s+[A-Z]\.)?(?:\s+[A-Z][a-z'-]+){1,3}$/;
  for (const line of lines) {
    if (line === parsed.company_name) continue;
    if (nameRe.test(line)) {
      parsed.contact_name = line;
      break;
    }
  }

  // ── Contact title ─────────────────────────────────────────────────
  for (const line of lines) {
    const ll = line.toLowerCase();
    if (TITLE_KEYWORDS.some((t) => ll.includes(t))) {
      parsed.contact_title = line;
      break;
    }
  }

  // ── Roles ─────────────────────────────────────────────────────────
  for (const [keyword, role] of Object.entries(ROLE_KEYWORDS)) {
    if (lower.includes(keyword)) {
      parsed.roles = role;
      break;
    }
  }

  // ── Commodities ───────────────────────────────────────────────────
  const foundCommodities = COMMODITY_KEYWORDS.filter((c) => lower.includes(c));
  if (foundCommodities.length > 0) {
    parsed.commodities = [...new Set(foundCommodities)].join(", ");
  }

  return parsed;
}

// ── Quick cleanup for Claude-enhanced text before re-parsing ──────────

export function cleanOcrText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
