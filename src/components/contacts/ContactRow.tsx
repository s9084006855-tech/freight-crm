import type { ContactSummary } from "../../types";
import { formatPhone } from "../../lib/phone";

interface Props {
  contact: ContactSummary;
  selected: boolean;
  onClick: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  active: "text-green-400",
  prospect: "text-yellow-400",
  inactive: "text-zinc-500",
  dnc: "text-red-500",
};

export function ContactRow({ contact, selected, onClick }: Props) {
  const statusColor = STATUS_COLORS[contact.status] ?? "text-zinc-400";

  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-4 px-4 py-2.5 cursor-pointer border-b border-zinc-800/50 transition-colors ${
        selected ? "bg-zinc-800" : "hover:bg-zinc-900"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-zinc-100 truncate">
            {contact.company_name}
          </span>
          {contact.has_follow_up && (
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" title="Follow-up due" />
          )}
        </div>
        <div className="text-xs text-zinc-500 truncate mt-0.5">
          {[contact.city, contact.state].filter(Boolean).join(", ")}
          {contact.roles && <span className="ml-2 text-zinc-600">{contact.roles}</span>}
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className="text-xs text-zinc-400 font-mono">
          {contact.phone ? formatPhone(contact.phone) : "—"}
        </div>
        <div className={`text-xs font-mono mt-0.5 ${statusColor}`}>
          {contact.status}
        </div>
      </div>
    </div>
  );
}
