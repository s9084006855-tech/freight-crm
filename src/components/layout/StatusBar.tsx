import { useContactsStore } from "../../store/contacts";

export function StatusBar() {
  const contacts = useContactsStore((s) => s.contacts);
  const loading = useContactsStore((s) => s.loading);
  const filter = useContactsStore((s) => s.filter);

  return (
    <div
      className="h-6 flex items-center px-4 gap-4 text-xs font-mono shrink-0"
      style={{
        background: "rgba(255,255,255,0.015)",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        color: "#4a4a65",
      }}
    >
      <span style={{ color: loading ? "#4a4a65" : "#6b6b8a" }}>
        {loading ? "Loading…" : `${contacts.length} contacts`}
      </span>
      {filter.search && (
        <span style={{ color: "#6366f1" }}>search: {filter.search}</span>
      )}
      {filter.role && (
        <span style={{ color: "#6b6b8a" }}>role: {filter.role}</span>
      )}
      {filter.state && (
        <span style={{ color: "#06b6d4" }}>state: {filter.state}</span>
      )}
    </div>
  );
}
