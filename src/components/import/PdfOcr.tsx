import { useState, useRef, useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ExtractedContact, ParsedContact } from "../../types";
import * as db from "../../lib/db";
import { useToast } from "../../hooks/useToast";
import { humanError } from "../../lib/errors";

interface Props {
  onExtracted: (contacts: ParsedContact[]) => void;
}

interface ProgressPayload {
  phase: "started" | "chunk_done" | "done";
  extracted: number;
  estimated: number | null;
  iteration?: number;
  new_in_batch?: number;
  has_more?: boolean;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Unexpected reader result type"));
    };
    reader.readAsDataURL(file);
  });
}

function extractedToParsed(e: ExtractedContact): ParsedContact {
  return {
    company_name: e.company_name,
    phone: e.phone,
    email: e.email,
    website: e.website,
    street: e.address,
    city: e.city,
    state: e.state,
    zip: e.zip,
    contact_name: e.contact_name,
    contact_title: e.contact_title,
    contact_phone: e.phone,
    contact_email: e.email,
  };
}

export function PdfOcr({ onExtracted }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [results, setResults] = useState<ExtractedContact[] | null>(null);
  const [chunkSize, setChunkSize] = useState(40);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<ProgressPayload>("ocr-pdf-progress", (event) => {
      setProgress(event.payload);
    }).then((fn) => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, []);

  const handleFile = (f: File) => {
    setFile(f);
    setResults(null);
    setProgress(null);
  };

  const run = async () => {
    if (!file) return;
    setProcessing(true);
    setProgress(null);
    setResults(null);
    try {
      const dataUrl = await fileToBase64(file);
      const contacts = await db.ocrPdfClaude(dataUrl, chunkSize);
      setResults(contacts);
      toast.success(`Extracted ${contacts.length} contacts`);
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setProcessing(false);
    }
  };

  const sendToReview = () => {
    if (!results || results.length === 0) return;
    onExtracted(results.map(extractedToParsed));
  };

  const sizeMb = file ? (file.size / 1024 / 1024).toFixed(2) : null;
  const progressPct =
    progress?.estimated && progress.extracted > 0
      ? Math.min(99, Math.round((progress.extracted / progress.estimated) * 100))
      : null;

  return (
    <div className="space-y-4">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f && f.type === "application/pdf") handleFile(f);
          else if (f) toast.error("PDF files only");
        }}
        className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-700 hover:border-zinc-500 rounded-lg p-8 cursor-pointer transition-colors"
      >
        {file ? (
          <div className="text-center">
            <p className="text-sm text-zinc-200 font-mono">{file.name}</p>
            <p className="text-xs text-zinc-500 mt-1">{sizeMb} MB</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-zinc-400">Drop a PDF or click to browse</p>
            <p className="text-xs text-zinc-600 mt-1">Multi-contact PDFs (e.g. Blue Book exports, scanned lists)</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
          className="hidden"
        />
      </div>

      {file && !processing && !results && (
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={run}
            className="px-4 py-1.5 text-sm font-mono bg-indigo-700 hover:bg-indigo-600 text-white rounded transition-colors"
          >
            Extract with Claude
          </button>
          <label className="text-xs text-zinc-500 font-mono flex items-center gap-2">
            Batch size:
            <input
              type="number"
              value={chunkSize}
              onChange={(e) => setChunkSize(Math.max(5, Math.min(100, Number(e.target.value) || 40)))}
              className="w-16 h-7 px-2 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500"
            />
            contacts/call
          </label>
          <span className="text-xs text-zinc-500 font-mono">~$0.05-0.50 total depending on PDF size</span>
        </div>
      )}

      {processing && (
        <div className="space-y-2 p-4 border border-zinc-800 rounded bg-zinc-900/50">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-300">
              {progress?.phase === "started" || !progress
                ? "Starting extraction…"
                : progress.phase === "done"
                  ? `Done — ${progress.extracted} contacts`
                  : `Extracted ${progress.extracted}${progress.estimated ? ` of ~${progress.estimated}` : ""} contacts (batch ${progress.iteration})`}
            </span>
            {progressPct !== null && (
              <span className="text-xs font-mono text-zinc-500">{progressPct}%</span>
            )}
          </div>
          <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-indigo-500 transition-all duration-500"
              style={{
                width: progressPct !== null ? `${progressPct}%` : "30%",
                animation: progressPct === null ? "pulse 1.5s ease-in-out infinite" : undefined,
              }}
            />
          </div>
        </div>
      )}

      {results && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-mono text-zinc-200">
              {results.length} contacts extracted
            </p>
            <button
              onClick={sendToReview}
              disabled={results.length === 0}
              className="px-4 py-1.5 text-sm font-mono bg-green-900/60 border border-green-700 text-green-200 hover:bg-green-900/80 rounded disabled:opacity-50 transition-colors"
            >
              Review & import →
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto border border-zinc-800 rounded bg-zinc-900/50 divide-y divide-zinc-800">
            {results.slice(0, 50).map((c, i) => (
              <div key={i} className="px-3 py-2 text-xs font-mono">
                <div className="text-zinc-200">
                  {c.company_name || <span className="text-zinc-600">(no company)</span>}
                </div>
                <div className="text-zinc-500 mt-0.5 truncate">
                  {[c.contact_name, c.phone, c.email, [c.city, c.state].filter(Boolean).join(", ")]
                    .filter(Boolean)
                    .join("  ·  ")}
                </div>
              </div>
            ))}
            {results.length > 50 && (
              <div className="px-3 py-2 text-xs text-zinc-600 font-mono text-center">
                + {results.length - 50} more…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
