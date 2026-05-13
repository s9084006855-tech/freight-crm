import { useState } from "react";
import { useContactsStore } from "../../store/contacts";
import { useUIStore } from "../../store/ui";
import { ActivityFeed } from "../activities/ActivityFeed";
import { Modal } from "../common/Modal";
import { ContactForm } from "./ContactForm";
import { formatPhone } from "../../lib/phone";
import * as db from "../../lib/db";
import { useToast } from "../../hooks/useToast";
import { humanError } from "../../lib/errors";

export function ContactDetail() {
  const contact = useContactsStore((s) => s.selected);
  const loading = useContactsStore((s) => s.detailLoading);
  const clearSelected = useContactsStore((s) => s.clearSelected);
  const fetchContacts = useContactsStore((s) => s.fetchContacts);
  const setView = useUIStore((s) => s.setView);
  const openQuickCall = useUIStore((s) => s.openQuickCall);
  const toast = useToast();

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!contact) return;
    setDeleting(true);
    try {
      await db.deleteContact(contact.id);
      await fetchContacts();
      clearSelected();
      setView("contacts");
      toast.success("Contact deleted");
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-zinc-600 font-mono">Loading…</p>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-xs text-zinc-600 font-mono">No contact selected</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <div>
          <button
            onClick={() => { clearSelected(); setView("contacts"); }}
            className="text-xs text-zinc-500 hover:text-zinc-300 mb-2 font-mono"
          >
            ← Back
          </button>
          <h1 className="text-lg font-semibold text-zinc-100">{contact.company_name}</h1>
          <p className="text-xs text-zinc-500 mt-0.5 font-mono">
            {[contact.city, contact.state].filter(Boolean).join(", ")}
            {contact.roles && <span className="ml-2">{contact.roles}</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => openQuickCall(contact.id)}
            className="px-3 py-1.5 text-xs font-mono bg-green-900/40 border border-green-700 text-green-300 rounded hover:bg-green-900/70 transition-colors"
          >
            Log Call (C)
          </button>
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-1.5 text-xs font-mono bg-zinc-800 border border-zinc-700 text-zinc-300 rounded hover:bg-zinc-700 transition-colors"
          >
            Edit (E)
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="px-3 py-1.5 text-xs font-mono text-red-400 hover:text-red-300 transition-colors"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Info panel */}
        <div className="w-72 shrink-0 border-r border-zinc-800 overflow-y-auto p-5 space-y-5">
          <Section label="Contact">
            <Field label="Phone" value={contact.phone ? formatPhone(contact.phone) : undefined} mono />
            <Field label="Fax" value={contact.fax ? formatPhone(contact.fax) : undefined} mono />
            <Field label="Email" value={contact.email} />
            <Field label="Website" value={contact.website} />
          </Section>

          <Section label="Location">
            <Field label="Street" value={contact.street} />
            <Field label="City" value={contact.city} />
            <Field label="State" value={contact.state} />
            <Field label="ZIP" value={contact.zip} />
          </Section>

          <Section label="Business">
            <Field label="Status" value={contact.status} />
            <Field label="Roles" value={contact.roles} />
            <Field label="Commodities" value={contact.commodities} />
            <Field label="Bluebook ID" value={contact.bbid} mono />
            <Field label="Source" value={contact.source} />
          </Section>

          {contact.people.length > 0 && (
            <Section label="People">
              {contact.people.map((p) => (
                <div key={p.id} className="mb-3">
                  <p className="text-sm text-zinc-200">{p.name}</p>
                  {p.title && <p className="text-xs text-zinc-500">{p.title}</p>}
                  {p.phone && <p className="text-xs text-zinc-400 font-mono">{formatPhone(p.phone)}</p>}
                  {p.email && <p className="text-xs text-zinc-400">{p.email}</p>}
                </div>
              ))}
            </Section>
          )}

          {contact.notes && (
            <Section label="Notes">
              <p className="text-xs text-zinc-400 whitespace-pre-wrap">{contact.notes}</p>
            </Section>
          )}
        </div>

        {/* Activity feed */}
        <div className="flex-1 overflow-hidden">
          <ActivityFeed contactId={contact.id} />
        </div>
      </div>

      {/* Edit modal */}
      <Modal open={editing} onClose={() => setEditing(false)} title="Edit contact" width="max-w-2xl">
        <ContactForm
          contact={contact}
          onSaved={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </Modal>

      {/* Delete confirm modal */}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete contact">
        <p className="text-sm text-zinc-300 mb-4">
          Delete <strong>{contact.company_name}</strong>? This also removes all activities. This cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setConfirmDelete(false)}
            className="px-4 py-1.5 text-sm font-mono text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-1.5 text-sm font-mono bg-red-900/50 border border-red-700 text-red-300 rounded hover:bg-red-900/80 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">{label}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="text-xs text-zinc-600 w-20 shrink-0">{label}</span>
      <span className={`text-xs text-zinc-300 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
