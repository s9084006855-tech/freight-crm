import { useContactsStore } from "../../store/contacts";

export function StatusBar() {
  const contacts = useContactsStore((s) => s.contacts);
  const loading = useContactsStore((s) => s.loading);
  const filter = useContactsStore((s) => s.filter);

  return (
    <div className="h-6 bg-zinc-950 border-t border-zinc-800 flex items-center px-4 gap-4 text-xs font-mono text-zinc-600 shrink-0">
      <span>{loading ? "Loading…" : `${contacts.length} contacts`}</span>
      {filter.search && <span>Search: {filter.search}</span>}
      {filter.role && <span>Role: {filter.role}</span>}
      {filter.state && <span>State: {filter.state}</span>}
    </div>
  );
}
