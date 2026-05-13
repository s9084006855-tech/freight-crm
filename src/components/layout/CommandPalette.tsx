import { useState, useRef, useEffect } from "react";
import { useUIStore } from "../../store/ui";
import { useContactsStore } from "../../store/contacts";
import * as db from "../../lib/db";
import type { ContactSummary, ViewName } from "../../types";

interface Command {
  id: string;
  label: string;
  action: () => void;
}

export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const close = useUIStore((s) => s.closeCommandPalette);
  const setView = useUIStore((s) => s.setView);
  const selectContact = useContactsStore((s) => s.selectContact);

  const [query, setQuery] = useState("");
  const [contactResults, setContactResults] = useState<ContactSummary[]>([]);
  const [focused, setFocused] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setContactResults([]);
      setFocused(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) { setContactResults([]); return; }
    db.searchContacts(query, 8).then(setContactResults).catch(() => {});
  }, [query]);

  const NAV_VIEWS: { label: string; view: ViewName }[] = [
    { label: "Go to Dashboard", view: "dashboard" },
    { label: "Go to Contacts", view: "contacts" },
    { label: "Go to Import", view: "import" },
    { label: "Go to Settings", view: "settings" },
  ];

  const navCommands: Command[] = NAV_VIEWS
    .filter((v) => !query || v.label.toLowerCase().includes(query.toLowerCase()))
    .map((v) => ({
      id: `nav-${v.view}`,
      label: v.label,
      action: () => { setView(v.view); close(); },
    }));

  const contactCommands: Command[] = contactResults.map((c) => ({
    id: `contact-${c.id}`,
    label: c.company_name,
    action: () => {
      setView("contact-detail");
      selectContact(c.id);
      close();
    },
  }));

  const allCommands = [...contactCommands, ...navCommands];

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocused((f) => Math.min(f + 1, allCommands.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocused((f) => Math.max(f - 1, 0));
    } else if (e.key === "Enter") {
      allCommands[focused]?.action();
    } else if (e.key === "Escape") {
      close();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-28 bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setFocused(0); }}
          onKeyDown={onKey}
          placeholder="Search contacts or type a command…"
          className="w-full px-4 py-3 bg-transparent text-sm text-zinc-100 font-mono placeholder:text-zinc-600 outline-none border-b border-zinc-800"
        />
        {allCommands.length > 0 && (
          <div className="max-h-72 overflow-y-auto">
            {allCommands.map((cmd, i) => (
              <button
                key={cmd.id}
                onMouseEnter={() => setFocused(i)}
                onClick={cmd.action}
                className={`w-full text-left px-4 py-2.5 text-sm font-mono transition-colors ${
                  i === focused ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {cmd.label}
              </button>
            ))}
          </div>
        )}
        {query && allCommands.length === 0 && (
          <p className="px-4 py-3 text-xs text-zinc-600 font-mono">No results</p>
        )}
      </div>
    </div>
  );
}
