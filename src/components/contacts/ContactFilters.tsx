import { useContactsStore } from "../../store/contacts";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
];

const STATUSES = ["active", "prospect", "inactive", "dnc"];

export function ContactFilters() {
  const filter = useContactsStore((s) => s.filter);
  const setFilter = useContactsStore((s) => s.setFilter);
  const resetFilter = useContactsStore((s) => s.resetFilter);

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 bg-zinc-950">
      <input
        type="text"
        value={filter.search ?? ""}
        onChange={(e) => setFilter({ search: e.target.value })}
        placeholder="Search… (⌘F)"
        className="h-7 px-2.5 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-500 w-52"
      />

      <select
        value={filter.state ?? ""}
        onChange={(e) => setFilter({ state: e.target.value || undefined })}
        className="h-7 px-2 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded text-zinc-400 outline-none focus:border-zinc-500"
      >
        <option value="">All states</option>
        {US_STATES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <select
        value={filter.status ?? ""}
        onChange={(e) => setFilter({ status: e.target.value || undefined })}
        className="h-7 px-2 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded text-zinc-400 outline-none focus:border-zinc-500"
      >
        <option value="">All statuses</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <select
        value={filter.sort_by ?? "name"}
        onChange={(e) =>
          setFilter({ sort_by: e.target.value as "name" | "last_contacted" | "state" | "priority" })
        }
        className="h-7 px-2 text-xs font-mono bg-zinc-900 border border-zinc-700 rounded text-zinc-400 outline-none focus:border-zinc-500"
      >
        <option value="name">Name</option>
        <option value="last_contacted">Last contacted</option>
        <option value="state">State</option>
        <option value="priority">Priority</option>
      </select>

      {(filter.search || filter.state || filter.status) && (
        <button
          onClick={resetFilter}
          className="h-7 px-2 text-xs font-mono text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Clear
        </button>
      )}
    </div>
  );
}
