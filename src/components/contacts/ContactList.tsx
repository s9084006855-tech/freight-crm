import { useRef, useState, useEffect, useCallback } from "react";
import { useContactsStore } from "../../store/contacts";
import { useUIStore } from "../../store/ui";
import { ContactRow } from "./ContactRow";
import { ContactFilters } from "./ContactFilters";

export function ContactList() {
  const contacts = useContactsStore((s) => s.contacts);
  const loading = useContactsStore((s) => s.loading);
  const selectContact = useContactsStore((s) => s.selectContact);
  const selected = useContactsStore((s) => s.selected);
  const setView = useUIStore((s) => s.setView);

  const [focusedIndex, setFocusedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback(
    (id: number) => {
      selectContact(id);
      setView("contact-detail");
    },
    [selectContact, setView]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, contacts.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const c = contacts[focusedIndex];
        if (c) handleSelect(c.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contacts, focusedIndex, handleSelect]);

  return (
    <div className="flex flex-col h-full">
      <ContactFilters />
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {loading && (
          <p className="text-xs text-zinc-600 font-mono p-4">Loading…</p>
        )}
        {!loading && contacts.length === 0 && (
          <p className="text-xs text-zinc-600 font-mono p-4">No contacts found.</p>
        )}
        {contacts.map((c, i) => (
          <ContactRow
            key={c.id}
            contact={c}
            selected={selected?.id === c.id || focusedIndex === i}
            onClick={() => handleSelect(c.id)}
          />
        ))}
      </div>
    </div>
  );
}
