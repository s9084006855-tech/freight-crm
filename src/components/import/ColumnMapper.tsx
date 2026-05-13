import type { ParsedContact } from "../../types";

const CONTACT_FIELDS: { value: keyof ParsedContact; label: string }[] = [
  { value: "company_name", label: "Company name" },
  { value: "phone", label: "Phone" },
  { value: "fax", label: "Fax" },
  { value: "email", label: "Email" },
  { value: "website", label: "Website" },
  { value: "street", label: "Street" },
  { value: "city", label: "City" },
  { value: "state", label: "State" },
  { value: "zip", label: "ZIP" },
  { value: "roles", label: "Roles" },
  { value: "commodities", label: "Commodities" },
  { value: "contact_name", label: "Contact name" },
  { value: "contact_title", label: "Contact title" },
  { value: "contact_phone", label: "Contact phone" },
  { value: "contact_email", label: "Contact email" },
  { value: "bbid", label: "Bluebook ID" },
  { value: "notes", label: "Notes" },
];

interface Props {
  headers: string[];
  mapping: Record<string, string>;
  onChange: (mapping: Record<string, string>) => void;
  sampleRow?: Record<string, string>;
}

export function ColumnMapper({ headers, mapping, onChange, sampleRow }: Props) {
  const setField = (header: string, field: string) => {
    const next = { ...mapping };
    if (!field) {
      delete next[header];
    } else {
      // Unset any other header mapped to the same field to avoid duplicates
      for (const [h, f] of Object.entries(next)) {
        if (f === field && h !== header) delete next[h];
      }
      next[header] = field;
    }
    onChange(next);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="text-left py-2 pr-4 text-zinc-500 font-normal">Source column</th>
            <th className="text-left py-2 pr-4 text-zinc-500 font-normal">Sample value</th>
            <th className="text-left py-2 text-zinc-500 font-normal">Maps to</th>
          </tr>
        </thead>
        <tbody>
          {headers.map((h) => (
            <tr key={h} className="border-b border-zinc-800/50">
              <td className="py-2 pr-4 text-zinc-300">{h}</td>
              <td className="py-2 pr-4 text-zinc-500 max-w-xs truncate">
                {sampleRow?.[h] ?? "—"}
              </td>
              <td className="py-2">
                <select
                  value={mapping[h] ?? ""}
                  onChange={(e) => setField(h, e.target.value)}
                  className="h-7 px-2 bg-zinc-800 border border-zinc-700 rounded text-zinc-200 outline-none focus:border-zinc-500 text-xs"
                >
                  <option value="">— skip —</option>
                  {CONTACT_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
