import { useState } from "react";
import { ContactList } from "../components/contacts/ContactList";
import { useContacts } from "../hooks/useContacts";
import { useUIStore } from "../store/ui";
import { Modal } from "../components/common/Modal";
import { ContactForm } from "../components/contacts/ContactForm";
import { useContactsStore } from "../store/contacts";

export function ContactsView() {
  useContacts();
  const openQuickCall = useUIStore((s) => s.openQuickCall);
  const selected = useContactsStore((s) => s.selected);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
        <h1 className="text-sm font-semibold text-zinc-100">Contacts</h1>
        <div className="flex gap-2">
          {selected && (
            <button
              onClick={() => openQuickCall(selected.id)}
              className="px-3 py-1.5 text-xs font-mono border border-zinc-700 text-zinc-400 hover:text-zinc-200 rounded transition-colors"
            >
              Log call (C)
            </button>
          )}
          <button
            onClick={() => setCreating(true)}
            className="px-3 py-1.5 text-xs font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded transition-colors"
          >
            + New (⌘N)
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <ContactList />
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New contact" width="max-w-2xl">
        <ContactForm
          onSaved={() => setCreating(false)}
          onCancel={() => setCreating(false)}
        />
      </Modal>
    </div>
  );
}
