import { useState, useRef } from "react";
import type { ParsedContact } from "../../types";
import * as db from "../../lib/db";
import { parsePastedText, cleanOcrText } from "../../lib/paste-parse";
import { useToast } from "../../hooks/useToast";
import { humanError } from "../../lib/errors";

interface Props {
  onParsed: (parsed: ParsedContact, confidence: number) => void;
}

export function ImageOCR({ onParsed }: Props) {
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [rawText, setRawText] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const handleFile = (file: File) => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    // Tauri file paths — use the file name from drag/drop
    // The actual path will be passed via dialog or from file drop via Tauri fs plugin
    setImagePath(file.name);
    setRawText(null);
  };

  const runOcr = async () => {
    if (!imagePath) return;
    setProcessing(true);
    try {
      const result = await db.ocrImage(imagePath);
      setRawText(result.text);
      setConfidence(result.confidence);
      const cleaned = cleanOcrText(result.text);
      const parsed = parsePastedText(cleaned);
      onParsed(parsed, result.confidence);
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
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
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
          accept=".png,.jpg,.jpeg,.webp,.tiff,.bmp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
          className="hidden"
        />
      </div>

      {imagePath && (
        <div className="flex items-center gap-3">
          <button
            onClick={runOcr}
            disabled={processing}
            className="px-4 py-1.5 text-sm font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded disabled:opacity-50 transition-colors"
          >
            {processing ? "Running OCR…" : "Run OCR"}
          </button>
          {confidence !== null && (
            <span className={`text-xs font-mono ${confidence >= 0.7 ? "text-green-400" : "text-yellow-400"}`}>
              {Math.round(confidence * 100)}% confidence
            </span>
          )}
        </div>
      )}

      {rawText && (
        <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
          <p className="text-xs text-zinc-500 mb-2">OCR output</p>
          <pre className="text-xs text-zinc-400 font-mono whitespace-pre-wrap">{rawText}</pre>
        </div>
      )}
    </div>
  );
}
