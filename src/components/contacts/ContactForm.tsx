import { useState } from "react";
import type { ContactDetail, CreateContactData } from "../../types";
import * as db from "../../lib/db";
import { useContactsStore } from "../../store/contacts";
import { useToast } from "../../hooks/useToast";
import { humanError } from "../../lib/errors";

interface Props {
  contact?: ContactDetail;
  onSaved: () => void;
  onCancel: () => void;
}

export function ContactForm({ contact, onSaved, onCancel }: Props) {
  const toast = useToast();
  const fetchContacts = useContactsStore((s) => s.fetchContacts);
  const refreshSelected = useContactsStore((s) => s.refreshSelected);

  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<CreateContactData>({
    company_name: contact?.company_name ?? "",
    phone: contact?.phone ?? "",
    fax: contact?.fax ?? "",
    email: contact?.email ?? "",
    website: contact?.website ?? "",
    street: contact?.street ?? "",
    city: contact?.city ?? "",
    state: contact?.state ?? "",
    zip: contact?.zip ?? "",
    roles: contact?.roles ?? "",
    commodities: contact?.commodities ?? "",
    status: contact?.status ?? "prospect",
    priority: contact?.priority ?? 0,
    notes: contact?.notes ?? "",
    bbid: contact?.bbid ?? "",
  });

  const set = (key: keyof CreateContactData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setData((d) => ({ ...d, [key]: e.target.value }));

  const save = async () => {
    if (!data.company_name.trim()) {
      toast.error("Company name is required");
      return;
    }
    setSaving(true);
    try {
      if (contact) {
        await db.updateContact(contact.id, data);
        await refreshSelected();
        toast.success("Contact updated");
      } else {
        await db.createContact(data);
        toast.success("Contact created");
      }
      await fetchContacts();
      onSaved();
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setSaving(false);
    }
  };

  const field = (
    label: string,
    key: keyof CreateContactData,
    type: string = "text"
  ) => (
    <div>
      <label className="block text-xs text-zinc-500 mb-1">{label}</label>
      <input
        type={type}
        value={(data[key] as string) ?? ""}
        onChange={set(key)}
        className="w-full h-8 px-2.5 text-sm font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500"
      />
    </div>
  );

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      {field("Company name *", "company_name")}
      <div className="grid grid-cols-2 gap-3">
        {field("Phone", "phone", "tel")}
        {field("Fax", "fax", "tel")}
        {field("Email", "email", "email")}
        {field("Website", "website", "url")}
      </div>
      {field("Street", "street")}
      <div className="grid grid-cols-3 gap-3">
        {field("City", "city")}
        {field("State", "state")}
        {field("ZIP", "zip")}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {field("Roles", "roles")}
        {field("Commodities", "commodities")}
        {field("Bluebook ID", "bbid")}
        <div>
          <label className="block text-xs text-zinc-500 mb-1">Status</label>
          <select
            value={data.status ?? "prospect"}
            onChange={set("status")}
            className="w-full h-8 px-2 text-sm font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500"
          >
            <option>prospect</option>
            <option>active</option>
            <option>inactive</option>
            <option>dnc</option>
          </select>
        </div>
      </div>
      <div>
        <label className="block text-xs text-zinc-500 mb-1">Notes</label>
        <textarea
          value={data.notes ?? ""}
          onChange={set("notes")}
          rows={3}
          className="w-full px-2.5 py-2 text-sm font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500 resize-none"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-1.5 text-sm font-mono text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-1.5 text-sm font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded transition-colors disabled:opacity-50"
        >
          {saving ? "Saving…" : contact ? "Update" : "Create"}
        </button>
      </div>
    </div>
  );
}
