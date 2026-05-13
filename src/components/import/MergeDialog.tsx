import { useState } from "react";
import type { ImportRow, ContactSummary } from "../../types";
import { Modal } from "../common/Modal";
import { formatPhone } from "../../lib/phone";

interface Props {
  row: ImportRow;
  duplicate: ContactSummary;
  open: boolean;
  onClose: () => void;
  onDecision: (action: "keep" | "merge" | "discard", mergeFields?: Record<string, boolean>) => void;
}

const MERGE_FIELDS = [
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "fax", label: "Fax" },
  { key: "website", label: "Website" },
  { key: "street", label: "Street" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "zip", label: "ZIP" },
  { key: "roles", label: "Roles" },
  { key: "commodities", label: "Commodities" },
  { key: "notes", label: "Notes" },
];

export function MergeDialog({ row, duplicate, open, onClose, onDecision }: Props) {
  const [mergeFields, setMergeFields] = useState<Record<string, boolean>>({});

  const toggle = (key: string) =>
    setMergeFields((m) => ({ ...m, [key]: !m[key] }));

  return (
    <Modal open={open} onClose={onClose} title="Potential duplicate" width="max-w-2xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 text-xs font-mono">
          <div className="bg-zinc-800 rounded p-3">
            <p className="text-zinc-500 mb-2">Existing contact</p>
            <p className="text-zinc-100 font-semibold">{duplicate.company_name}</p>
            {duplicate.phone && <p className="text-zinc-400">{formatPhone(duplicate.phone)}</p>}
            {duplicate.email && <p className="text-zinc-400">{duplicate.email}</p>}
            <p className="text-zinc-500 mt-1">{[duplicate.city, duplicate.state].filter(Boolean).join(", ")}</p>
          </div>
          <div className="bg-zinc-800 rounded p-3">
            <p className="text-zinc-500 mb-2">Incoming row</p>
            <p className="text-zinc-100 font-semibold">{row.parsed.company_name}</p>
            {row.parsed.phone && <p className="text-zinc-400">{formatPhone(row.parsed.phone)}</p>}
            {row.parsed.email && <p className="text-zinc-400">{row.parsed.email}</p>}
            <p className="text-zinc-500 mt-1">{[row.parsed.city, row.parsed.state].filter(Boolean).join(", ")}</p>
          </div>
        </div>

        <div>
          <p className="text-xs text-zinc-500 mb-2">
            If you merge, check which fields to update on the existing contact:
          </p>
          <div className="grid grid-cols-3 gap-2">
            {MERGE_FIELDS.map((f) => {
              const hasValue = !!(row.parsed as Record<string, unknown>)[f.key];
              if (!hasValue) return null;
              return (
                <label key={f.key} className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!mergeFields[f.key]}
                    onChange={() => toggle(f.key)}
                    className="rounded"
                  />
                  {f.label}: <span className="text-zinc-300 font-mono truncate">{String((row.parsed as Record<string, unknown>)[f.key])}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={() => onDecision("discard")}
            className="px-4 py-1.5 text-sm font-mono text-zinc-500 hover:text-zinc-300"
          >
            Discard incoming
          </button>
          <button
            onClick={() => onDecision("merge", mergeFields)}
            className="px-4 py-1.5 text-sm font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded"
          >
            Merge
          </button>
          <button
            onClick={() => onDecision("keep")}
            className="px-4 py-1.5 text-sm font-mono bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded"
          >
            Keep as new
          </button>
        </div>
      </div>
    </Modal>
  );
}
