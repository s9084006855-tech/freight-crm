import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, CheckCircle, XCircle, Loader, AlertCircle, Globe, Truck, MapPin, User } from "lucide-react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import * as db from "../../lib/db";
import type { EnrichmentResult } from "../../types";

export function EnrichmentPanel() {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<EnrichmentResult[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<EnrichmentResult | null>(null);
  const [done, setDone] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  useState(() => {
    db.hasApiKey().then(setHasApiKey).catch(() => setHasApiKey(false));
  });

  const runEnrichAll = async () => {
    setRunning(true);
    setDone(false);
    setResults([]);
    try {
      const contacts = await db.getContacts({ limit: 5000, offset: 0 });
      // Only count unenriched ones
      setTotal(contacts.length);
    } catch { setTotal(249); }

    unlistenRef.current = await listen<EnrichmentResult>("enrich-progress", (event) => {
      setResults((prev) => [...prev, event.payload]);
    });

    try {
      await db.enrichAllContacts();
    } catch {
      // partial results already streamed
    } finally {
      if (unlistenRef.current) { unlistenRef.current(); unlistenRef.current = null; }
      setRunning(false);
      setDone(true);
    }
  };

  const failed = results.filter((r) => r.error).length;
  const webSearched = results.filter((r) => r.web_searched).length;
  const progress = total > 0 ? Math.min((results.length / total) * 100, 100) : results.length > 0 ? 50 : 5;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "#f0f0f5" }}>AI Contact Research</h2>
            <p className="text-xs mt-1" style={{ color: "#6b6b8a" }}>
              Claude searches the web for each company — builds a full profile and cold call script.
              Already-enriched contacts are skipped.
            </p>
          </div>

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={runEnrichAll}
            disabled={running || hasApiKey === false}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-40"
            style={{
              background: running ? "rgba(99,102,241,0.1)" : "linear-gradient(135deg, #6366f1, #8b5cf6)",
              border: "1px solid rgba(99,102,241,0.4)",
              color: "#f0f0f5",
              boxShadow: running ? "none" : "0 4px 16px rgba(99,102,241,0.3)",
            }}
          >
            {running
              ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}><Loader size={14} /></motion.div>
              : <Sparkles size={14} />}
            {running ? `${results.length}${total ? `/${total}` : ""} researched…` : done ? "Re-run on New Contacts" : "Research All Contacts"}
          </motion.button>
        </div>

        {hasApiKey === false && (
          <div className="flex items-center gap-2 mt-3 px-3 py-2 rounded-lg text-xs"
            style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "#f59e0b" }}>
            <AlertCircle size={12} />
            Go to Settings → Anthropic API key → add your key first.
          </div>
        )}

        <AnimatePresence>
          {running && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mt-4">
              <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                <motion.div className="h-full rounded-full"
                  style={{ background: "linear-gradient(90deg, #6366f1, #8b5cf6)" }}
                  animate={{ width: `${progress}%` }} transition={{ duration: 0.3 }} />
              </div>
              <p className="text-xs mt-2" style={{ color: "#6b6b8a" }}>
                {results.length}{total ? ` / ${total}` : ""} done · 5 parallel web searches · ~{Math.ceil(total / 5) * 6}s total
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {done && results.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex gap-4 mt-4">
            <div className="flex items-center gap-1.5">
              <CheckCircle size={13} color="#10b981" />
              <span className="text-xs" style={{ color: "#10b981" }}>{webSearched} profiles built</span>
            </div>
            {failed > 0 && (
              <div className="flex items-center gap-1.5">
                <XCircle size={13} color="#ef4444" />
                <span className="text-xs" style={{ color: "#ef4444" }}>{failed} failed</span>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {results.length === 0 && !running && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
              <Sparkles size={20} color="#6366f1" />
            </div>
            <p className="text-sm" style={{ color: "#6b6b8a" }}>
              {hasApiKey ? 'Click "Research All Contacts" to start' : "Add API key in Settings first"}
            </p>
            <div className="text-xs text-center max-w-sm space-y-1" style={{ color: "#4a4a65" }}>
              <p>Finds commodities, shipping lanes, key contacts, and company size.</p>
              <p>Already-enriched contacts are never re-processed.</p>
            </div>
          </div>
        )}

        {results.map((r, i) => (
          <motion.div
            key={r.contact_id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.01, 0.3) }}
            style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
          >
            <button
              onClick={() => setSelected(selected?.contact_id === r.contact_id ? null : r)}
              className="w-full text-left px-6 py-3 transition-colors"
              style={{ background: selected?.contact_id === r.contact_id ? "rgba(99,102,241,0.06)" : "transparent" }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  {r.error
                    ? <XCircle size={13} color="#ef4444" className="shrink-0" />
                    : <CheckCircle size={13} color="#10b981" className="shrink-0" />}
                  <span className="text-sm truncate" style={{ color: r.error ? "#6b6b8a" : "#f0f0f5" }}>
                    {r.company_name}
                  </span>
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  {r.commodities.length > 0 && (
                    <span className="text-xs" style={{ color: "#6366f1" }}>
                      {r.commodities.slice(0, 2).join(", ").toLowerCase()}
                    </span>
                  )}
                  {r.web_searched && (
                    <span className="text-xs px-1.5 py-0.5 rounded"
                      style={{ background: "rgba(16,185,129,0.12)", color: "#10b981", fontSize: "10px" }}>
                      web
                    </span>
                  )}
                </div>
              </div>

              {/* Quick profile chips */}
              {!r.error && (r.role || r.key_contact_title || r.shipping_lanes.length > 0) && (
                <div className="flex flex-wrap gap-1.5 mt-1.5 ml-5">
                  {r.role && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(255,255,255,0.04)", color: "#8b8ba8" }}>
                      <Truck size={9} />{r.role}
                    </span>
                  )}
                  {r.key_contact_title && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(255,255,255,0.04)", color: "#8b8ba8" }}>
                      <User size={9} />{r.key_contact_title}
                    </span>
                  )}
                  {r.shipping_lanes[0] && (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(255,255,255,0.04)", color: "#8b8ba8" }}>
                      <MapPin size={9} />{r.shipping_lanes[0]}
                    </span>
                  )}
                </div>
              )}
            </button>

            {/* Expanded detail */}
            <AnimatePresence>
              {selected?.contact_id === r.contact_id && !r.error && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden px-6 pb-4"
                >
                  {/* Profile summary */}
                  {(r.profile_notes || r.annual_volume_estimate || r.website) && (
                    <div className="mb-3 p-3 rounded-xl text-xs space-y-1.5"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      {r.profile_notes && <p style={{ color: "#a0a0be" }}>{r.profile_notes}</p>}
                      {r.annual_volume_estimate && (
                        <p className="flex items-center gap-1.5" style={{ color: "#6b6b8a" }}>
                          <Truck size={10} />{r.annual_volume_estimate}
                        </p>
                      )}
                      {r.website && (
                        <p className="flex items-center gap-1.5" style={{ color: "#6b6b8a" }}>
                          <Globe size={10} />{r.website}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Cold call script */}
                  <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono p-4 rounded-xl"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", color: "#8b8ba8" }}>
                    {r.cold_call_script}
                  </pre>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
