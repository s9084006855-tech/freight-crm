import { useEffect } from "react";
import { useContactsStore } from "../store/contacts";

export function useContacts() {
  const store = useContactsStore();

  useEffect(() => {
    store.fetchContacts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return store;
}
