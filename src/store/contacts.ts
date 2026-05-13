import { create } from "zustand";
import type { ContactSummary, ContactDetail, ContactFilter } from "../types";
import * as db from "../lib/db";
import { logError } from "../lib/errors";

interface ContactsState {
  contacts: ContactSummary[];
  selected: ContactDetail | null;
  filter: ContactFilter;
  loading: boolean;
  detailLoading: boolean;

  fetchContacts: () => Promise<void>;
  selectContact: (id: number) => Promise<void>;
  clearSelected: () => void;
  setFilter: (patch: Partial<ContactFilter>) => void;
  resetFilter: () => void;
  refreshSelected: () => Promise<void>;
}

const DEFAULT_FILTER: ContactFilter = {
  search: "",
  state: undefined,
  status: undefined,
  sort_by: "name",
  sort_desc: false,
  limit: 500,
  offset: 0,
};

export const useContactsStore = create<ContactsState>((set, get) => ({
  contacts: [],
  selected: null,
  filter: DEFAULT_FILTER,
  loading: false,
  detailLoading: false,

  fetchContacts: async () => {
    set({ loading: true });
    try {
      const contacts = await db.getContacts(get().filter);
      set({ contacts, loading: false });
    } catch (e) {
      await logError(String(e), "contacts/fetchContacts");
      set({ loading: false });
    }
  },

  selectContact: async (id) => {
    set({ detailLoading: true });
    try {
      const selected = await db.getContact(id);
      set({ selected, detailLoading: false });
    } catch (e) {
      await logError(String(e), "contacts/selectContact");
      set({ detailLoading: false });
    }
  },

  clearSelected: () => set({ selected: null }),

  setFilter: (patch) => {
    set((s) => ({ filter: { ...s.filter, ...patch, offset: 0 } }));
    get().fetchContacts();
  },

  resetFilter: () => {
    set({ filter: DEFAULT_FILTER });
    get().fetchContacts();
  },

  refreshSelected: async () => {
    const id = get().selected?.id;
    if (id == null) return;
    await get().selectContact(id);
  },
}));
