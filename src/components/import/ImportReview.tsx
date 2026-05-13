import { useState } from "react";
import type { ImportRow, ImportAction, ContactSummary } from "../../types";
import { MergeDialog } from "./MergeDialog";
import { formatPhone } from "../../lib/phone";

interface Props {
  rows: ImportRow[];
  existingContacts: ContactSummary[];
  onActions: (actions: ImportAction[]) => void;
  onBack: () => void;
}

const STATUS_COLORS = {
  green: "border-l-green-500",
  yellow: "border-l-yellow-400",
  red: "border-l-red-500",
};

const STATUS_LABELS = {
  green: "Ready",
  yellow: "Review",
  red: "Issues",
};

export function ImportReview({ rows, existingContacts, onActions, onBack }: Props) {
  const [actions, setActions] = useState<Record<number, ImportAction>>(() => {
    const init: Record<number, ImportAction> = {};
    for (const row of rows) {
      init[row.row_index] = {
        row_index: row.row_index,
        action: row.status === "yellow" ? "discard" : row.status === "red" ? "discard" : "keep",
        merge_contact_id: row.duplicate_contact_id,
      };
    }
    return init;
  });

  const [mergeTarget, setMergeTarget] = useState<ImportRow | null>(null);
  const [filter, setFilter] = useState<"all" | "green" | "yellow" | "red">("all");

  const setAction = (rowIndex: number, action: "keep" | "merge" | "discard", mergeFields?: Record<string, boolean>) => {
    setActions((a) => ({
      ...a,
      [rowIndex]: {
        ...a[rowIndex],
        action,
        merge_contact_id: action === "merge" ? rows.find((r) => r.row_index === rowIndex)?.duplicate_contact_id : undefined,
        merge_fields: mergeFields,
      },
    }));
  };

  const setAll = (action: "keep" | "discard", statusFilter?: string) => {
    setActions((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        if (!statusFilter || row.status === statusFilter) {
          next[row.row_index] = { ...next[row.row_index], action };
        }
      }
      return next;
    });
  };

  const visible = rows.filter((r) => filter === "all" || r.status === filter);
  const keepCount = Object.values(actions).filter((a) => a.action === "keep" || a.action === "merge").length;

  const counts = {
    green: rows.filter((r) => r.status === "green").length,
    yellow: rows.filter((r) => r.status === "yellow").length,
    red: rows.filter((r) => r.status === "red").length,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-xs text-zinc-500 hover:text-zinc-300 font-mono">
            ← Back
          </button>
          <div className="flex gap-1.5">
            {(["all", "green", "yellow", "red"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-2.5 py-1 text-xs font-mono rounded transition-colors ${
                  filter === s ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {s === "all" ? `All (${rows.length})` : `${STATUS_LABELS[s]} (${counts[s]})`}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setAll("keep")} className="text-xs text-zinc-500 hover:text-zinc-300 font-mono">
            Keep all
          </button>
          <button onClick={() => setAll("discard")} className="text-xs text-zinc-500 hover:text-zinc-300 font-mono">
            Discard all
          </button>
          <button
            onClick={() => onActions(Object.values(actions))}
            className="px-4 py-1.5 text-xs font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded transition-colors"
          >
            Import {keepCount} contacts →
          </button>
        </div>
      </div>

      {/* Row list */}
      <div className="flex-1 overflow-y-auto">
        {visible.map((row) => {
          const action = actions[row.row_index];
          const dup = row.duplicate_contact_id
            ? existingContacts.find((c) => c.id === row.duplicate_contact_id)
            : undefined;

          return (
            <div
              key={row.row_index}
              className={`flex items-start gap-4 px-5 py-3 border-b border-zinc-800/50 border-l-2 ${STATUS_COLORS[row.status]}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-zinc-200">
                    {row.parsed.company_name || <span className="text-zinc-600 italic">No company name</span>}
                  </span>
                  {row.issues.length > 0 && (
                    <span className="text-xs text-zinc-500 font-mono">
                      — {row.issues.join("; ")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5 font-mono">
                  {[
                    row.parsed.phone ? formatPhone(row.parsed.phone) : null,
                    row.parsed.email,
                    [row.parsed.city, row.parsed.state].filter(Boolean).join(", "),
                  ].filter(Boolean).join(" · ")}
                </div>
                {dup && (
                  <div className="text-xs text-yellow-500 mt-0.5 font-mono">
                    Possible duplicate of: {dup.company_name}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {(["keep", "merge", "discard"] as const).map((a) => {
                  if (a === "merge" && !dup) return null;
                  return (
                    <button
                      key={a}
                      onClick={() => {
                        if (a === "merge" && dup) {
                          setMergeTarget(row);
                        } else {
                          setAction(row.row_index, a);
                        }
                      }}
                      className={`px-2.5 py-1 text-xs font-mono rounded border transition-colors ${
                        action?.action === a
                          ? a === "keep" || a === "merge"
                            ? "border-green-600 bg-green-900/30 text-green-300"
                            : "border-red-700 bg-red-900/20 text-red-300"
                          : "border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {a}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {mergeTarget && (() => {
        const dup = existingContacts.find((c) => c.id === mergeTarget.duplicate_contact_id);
        if (!dup) return null;
        return (
          <MergeDialog
            row={mergeTarget}
            duplicate={dup}
            open={true}
            onClose={() => setMergeTarget(null)}
            onDecision={(a, fields) => {
              setAction(mergeTarget.row_index, a, fields);
              setMergeTarget(null);
            }}
          />
        );
      })()}
    </div>
  );
}
