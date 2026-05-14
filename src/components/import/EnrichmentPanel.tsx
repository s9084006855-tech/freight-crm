import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, CheckCircle, XCircle, Loader } from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import * as db from "../../lib/db";
import type { EnrichmentResult } from "../../types";

export function EnrichmentPanel() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<EnrichmentResult[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<EnrichmentResult | null>(null);
  const [done, setDone] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  const runEnrichAll = async () => {
    setRunning(true);
    setDone(false);
    setResults([]);

    // Count contacts to enrich first for progress bar
    try {
      const contacts = await db.getContacts({ limit: 5000, offset: 0 });
      setTotal(contacts.length);
    } catch {
      setTotal(249);
    }

    // Listen for streaming progress events
    unlistenRef.current = await listen<EnrichmentResult>("enrich-progress", (event) => {
      setResults((prev) => [...prev, event.payload]);
    });

    try {
      // This call returns when ALL done — but UI already has live results via events
      await db.enrichAllContacts();
    } catch {
      // partial results already collected via events
    } finally {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      setRunning(false);
      setDone(true);
    }
  };

  const found = results.filter((r) => r.found_on_importyeti).length;
  const failed = results.filter((r) => r.error).length;
  const progress = total > 0 ? Math.min((results.length / total) * 100, 100) : results.length > 0 ? 50 : 5;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-6 py-5 shrink-0"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "#f0f0f5" }}>
              Contact Enrichment
            </h2>
            <p className="text-xs mt-1" style={{ color: "#6b6b8a" }}>
              Scrapes ImportYeti for shipping records and generates a cold call
              script for each contact.
            </p>
          </div>

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={runEnrichAll}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
            style={{
              background: running
                ? "rgba(99,102,241,0.1)"
                : "linear-gradient(135deg, #6366f1, #8b5cf6)",
              border: "1px solid rgba(99,102,241,0.4)",
              color: "#f0f0f5",
              boxShadow: running ? "none" : "0 4px 16px rgba(99,102,241,0.3)",
            }}
          >
            {running ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
              >
                <Loader size={14} />
              </motion.div>
            ) : (
              <Sparkles size={14} />
            )}
            {running ? `Enriching… ${results.length}${total ? `/${total}` : ""} done` : "Enrich All Contacts"}
          </motion.button>
        </div>

        {/* Progress bar */}
        <AnimatePresence>
          {running && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4"
            >
              <div
                className="h-1 rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,0.06)" }}
              >
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
                  }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              <p className="text-xs mt-2" style={{ color: "#6b6b8a" }}>
                {results.length}{total ? ` / ${total}` : ""} contacts processed — running {Math.ceil((total || 249) / 8)} parallel batches
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Summary */}
        {done && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex gap-4 mt-4"
          >
            <div className="flex items-center gap-1.5">
              <CheckCircle size={13} color="#10b981" />
              <span className="text-xs" style={{ color: "#10b981" }}>
                {found} found on ImportYeti
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Sparkles size={13} color="#6366f1" />
              <span className="text-xs" style={{ color: "#6366f1" }}>
                {results.length - failed} scripts generated
              </span>
            </div>
            {failed > 0 && (
              <div className="flex items-center gap-1.5">
                <XCircle size={13} color="#ef4444" />
                <span className="text-xs" style={{ color: "#ef4444" }}>
                  {failed} failed
                </span>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Results list */}
      <div className="flex-1 overflow-y-auto">
        {results.length === 0 && !running && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}
            >
              <Sparkles size={20} color="#6366f1" />
            </div>
            <p className="text-sm" style={{ color: "#6b6b8a" }}>
              Click "Enrich All Contacts" to start
            </p>
            <p className="text-xs text-center max-w-xs" style={{ color: "#4a4a65" }}>
              Searches ImportYeti for each company's shipping history and
              generates a personalized cold call script. Runs 8 at a time for speed.
            </p>
          </div>
        )}

        {results.map((r, i) => (
          <motion.button
            key={r.contact_id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.01, 0.3) }}
            onClick={() => setSelected(selected?.contact_id === r.contact_id ? null : r)}
            className="w-full text-left px-6 py-3 transition-colors"
            style={{
              borderBottom: "1px solid rgba(255,255,255,0.04)",
              background:
                selected?.contact_id === r.contact_id
                  ? "rgba(99,102,241,0.06)"
                  : "transparent",
            }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                {r.error ? (
                  <XCircle size={13} color="#ef4444" className="shrink-0" />
                ) : r.found_on_importyeti ? (
                  <CheckCircle size={13} color="#10b981" className="shrink-0" />
                ) : (
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ background: "rgba(255,255,255,0.15)" }}
                  />
                )}
                <span
                  className="text-sm truncate"
                  style={{ color: r.error ? "#6b6b8a" : "#f0f0f5" }}
                >
                  {r.company_name}
                </span>
              </div>
              {r.commodities.length > 0 && (
                <span
                  className="text-xs ml-3 shrink-0"
                  style={{ color: "#6366f1" }}
                >
                  {r.commodities.slice(0, 2).join(", ").toLowerCase()}
                </span>
              )}
            </div>

            {/* Expanded script */}
            <AnimatePresence>
              {selected?.contact_id === r.contact_id && !r.error && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <pre
                    className="mt-3 text-xs leading-relaxed whitespace-pre-wrap font-mono p-4 rounded-xl"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      color: "#8b8ba8",
                    }}
                  >
                    {r.cold_call_script}
                  </pre>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
