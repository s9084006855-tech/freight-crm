import { useState, useRef } from "react";
import type { ParsedContact, ExtractedContact } from "../../types";
import * as db from "../../lib/db";
import { useToast } from "../../hooks/useToast";
import { humanError } from "../../lib/errors";

interface Props {
  onParsed: (parsed: ParsedContact, confidence: number) => void;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result); // data URL; backend strips the prefix
      } else {
        reject(new Error("Unexpected reader result type"));
      }
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

export function ImageOCR({ onParsed }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [rawText, setRawText] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [extracted, setExtracted] = useState<ExtractedContact | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const handleFile = (f: File) => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setRawText(null);
    setConfidence(null);
    setExtracted(null);
  };

  const runOcr = async () => {
    if (!file) return;
    setProcessing(true);
    try {
      const dataUrl = await fileToBase64(file);
      const result = await db.ocrImageClaude(dataUrl, file.type || "image/png");
      setRawText(result.text);
      setConfidence(result.confidence);
      if (result.extracted) {
        setExtracted(result.extracted);
        onParsed(extractedToParsed(result.extracted), result.confidence);
      }
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-700 hover:border-zinc-500 rounded-lg p-8 cursor-pointer transition-colors"
      >
        {preview ? (
          <img src={preview} alt="OCR input" className="max-h-48 rounded object-contain" />
        ) : (
          <>
            <p className="text-sm text-zinc-400">Drop an image or click to browse</p>
            <p className="text-xs text-zinc-600 mt-1">Business card, screenshot, photo</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.gif"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
          className="hidden"
        />
      </div>

      {file && (
        <div className="flex items-center gap-3">
          <button
            onClick={runOcr}
            disabled={processing}
            className="px-4 py-1.5 text-sm font-mono bg-indigo-700 hover:bg-indigo-600 text-white rounded disabled:opacity-50 transition-colors"
          >
            {processing ? "Extracting…" : "Extract with Claude"}
          </button>
          <span className="text-xs text-zinc-500 font-mono">~$0.003 per image</span>
          {confidence !== null && (
            <span className={`text-xs font-mono ${confidence >= 0.7 ? "text-green-400" : "text-yellow-400"}`}>
              {Math.round(confidence * 100)}% confidence
            </span>
          )}
        </div>
      )}

      {extracted && (
        <div className="bg-zinc-900 border border-zinc-800 rounded p-4 space-y-2">
          <p className="text-xs text-zinc-500 mb-2 uppercase tracking-wider">Extracted fields</p>
          <FieldRow label="Company" value={extracted.company_name} />
          <FieldRow label="Contact" value={extracted.contact_name} />
          <FieldRow label="Title" value={extracted.contact_title} />
          <FieldRow label="Phone" value={extracted.phone} extra={extracted.phones.length > 1 ? `+${extracted.phones.length - 1} more` : undefined} />
          <FieldRow label="Email" value={extracted.email} extra={extracted.emails.length > 1 ? `+${extracted.emails.length - 1} more` : undefined} />
          <FieldRow label="Website" value={extracted.website} />
          <FieldRow label="Address" value={extracted.address} />
          <FieldRow label="City / State / Zip" value={[extracted.city, extracted.state, extracted.zip].filter(Boolean).join(", ") || undefined} />
        </div>
      )}

      {rawText && (
        <details className="bg-zinc-900 border border-zinc-800 rounded p-3">
          <summary className="text-xs text-zinc-500 cursor-pointer">Raw OCR text</summary>
          <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap mt-2">{rawText}</pre>
        </details>
      )}
    </div>
  );
}

function FieldRow({ label, value, extra }: { label: string; value?: string; extra?: string }) {
  return (
    <div className="flex items-baseline gap-3 text-xs font-mono">
      <span className="text-zinc-600 w-32 shrink-0">{label}</span>
      <span className={value ? "text-zinc-200" : "text-zinc-700"}>
        {value || "—"}
      </span>
      {extra && <span className="text-zinc-600 text-[10px]">{extra}</span>}
    </div>
  );
}
