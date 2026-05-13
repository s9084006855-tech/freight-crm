import { useState } from "react";
import { parsePastedText, cleanOcrText } from "../../lib/paste-parse";
import type { ParsedContact } from "../../types";
import * as db from "../../lib/db";
import { useToast } from "../../hooks/useToast";
import { humanError } from "../../lib/errors";

interface Props {
  onParsed: (parsed: ParsedContact) => void;
}

export function PasteParser({ onParsed }: Props) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ParsedContact | null>(null);
  const [enhancing, setEnhancing] = useState(false);
  const [hasApiKey, setHasApiKey] = useState<boolean | null>(null);
  const toast = useToast();

  const parse = () => {
    const cleaned = cleanOcrText(text);
    const parsed = parsePastedText(cleaned);
    setPreview(parsed);
  };

  const enhance = async () => {
    if (!text.trim()) return;
    setEnhancing(true);
    try {
      // Check API key exists (one-time check)
      if (hasApiKey === null) {
        const has = await db.hasApiKey();
        setHasApiKey(has);
        if (!has) {
          toast.error("No API key configured. Add one in Settings.");
          return;
        }
      }
      // Enhancement uses the Tauri backend which calls Claude API
      // For now just parse — full Claude enhancement is wired in Settings
      const cleaned = cleanOcrText(text);
      const parsed = parsePastedText(cleaned);
      setPreview(parsed);
      toast.info("Enhanced with local parsing (Claude enhancement available via API key in Settings)");
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setEnhancing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-zinc-500 mb-1.5">Paste text (business card, email signature, web page…)</label>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setPreview(null); }}
          rows={8}
          placeholder="ABC Produce Inc.&#10;John Martinez — Traffic Manager&#10;(555) 234-5678&#10;jmartinez@abcproduce.com&#10;123 Market St, Salinas, CA 93901"
          className="w-full px-3 py-2.5 text-sm font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-500 resize-none"
        />
      </div>

      <div className="flex gap-3">
        <button
          onClick={parse}
          disabled={!text.trim()}
          className="px-4 py-1.5 text-sm font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded disabled:opacity-50 transition-colors"
        >
          Parse
        </button>
        <button
          onClick={enhance}
          disabled={!text.trim() || enhancing}
          className="px-4 py-1.5 text-sm font-mono border border-zinc-600 text-zinc-400 hover:text-zinc-200 rounded disabled:opacity-50 transition-colors"
          title="~$0.001 per request"
        >
          {enhancing ? "Enhancing…" : "Enhance with Claude (~$0.001)"}
        </button>
      </div>

      {preview && (
        <div className="bg-zinc-900 border border-zinc-800 rounded p-4">
          <p className="text-xs text-zinc-500 mb-3">Parsed result</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs font-mono">
            {(Object.entries(preview) as [string, string][])
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-zinc-600 w-28 shrink-0">{k}</span>
                  <span className="text-zinc-300 truncate">{v}</span>
                </div>
              ))}
          </div>
          <div className="mt-4 flex justify-end">
            <button
              onClick={() => onParsed(preview)}
              className="px-4 py-1.5 text-sm font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded transition-colors"
            >
              Use this →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
