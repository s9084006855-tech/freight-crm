import { useState } from "react";
import type { ParsedContact } from "../../types";
import * as db from "../../lib/db";
import { useContactsStore } from "../../store/contacts";
import { useToast } from "../../hooks/useToast";
import { humanError } from "../../lib/errors";

export function QuickAddForm({ onSaved }: { onSaved?: () => void }) {
  const fetchContacts = useContactsStore((s) => s.fetchContacts);
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<ParsedContact>({
    company_name: "",
    phone: "",
    email: "",
    city: "",
    state: "",
    roles: "",
    notes: "",
  });

  const set = (key: keyof ParsedContact) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async () => {
    if (!form.company_name?.trim()) {
      toast.error("Company name is required");
      return;
    }
    setSaving(true);
    try {
      await db.createContact({
        company_name: form.company_name!,
        phone: form.phone || undefined,
        email: form.email || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        roles: form.roles || undefined,
        notes: form.notes || undefined,
        source: "quick-add",
        status: "prospect",
      });
      await fetchContacts();
      toast.success("Contact added");
      setForm({ company_name: "", phone: "", email: "", city: "", state: "", roles: "", notes: "" });
      onSaved?.();
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 max-w-lg">
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Company name *</label>
        <input
          value={form.company_name ?? ""}
          onChange={set("company_name")}
          autoFocus
          className="w-full h-8 px-2.5 text-sm font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Phone</label>
          <input
            value={form.phone ?? ""}
            onChange={set("phone")}
            type="tel"
            className="w-full h-8 px-2.5 text-sm font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Email</label>
          <input
            value={form.email ?? ""}
            onChange={set("email")}
            type="email"
            className="w-full h-8 px-2.5 text-sm font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">City</label>
          <input
            value={form.city ?? ""}
            onChange={set("city")}
            className="w-full h-8 px-2.5 text-sm font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 mb-1">State</label>
          <input
            value={form.state ?? ""}
            onChange={set("state")}
            maxLength={2}
            className="w-full h-8 px-2.5 text-sm font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500 uppercase"
          />
        </div>
      </div>
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Roles (shipper / receiver / etc.)</label>
        <input
          value={form.roles ?? ""}
          onChange={set("roles")}
          className="w-full h-8 px-2.5 text-sm font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500"
        />
      </div>
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Notes</label>
        <textarea
          value={form.notes ?? ""}
          onChange={set("notes")}
          rows={2}
          className="w-full px-2.5 py-2 text-sm font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500 resize-none"
        />
      </div>
      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="px-5 py-2 text-sm font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded disabled:opacity-50 transition-colors"
        >
          {saving ? "Adding…" : "Add contact (⌘↵)"}
        </button>
      </div>
    </div>
  );
}
