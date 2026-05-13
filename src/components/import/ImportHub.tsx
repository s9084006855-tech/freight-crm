import { useState } from "react";
import type { ImportRow, ImportAction, ContactSummary, ParsedContact, MappingTemplate } from "../../types";
import { DropZone } from "./DropZone";
import { ColumnMapper } from "./ColumnMapper";
import { ImportReview } from "./ImportReview";
import { ImportHistory } from "./ImportHistory";
import { PasteParser } from "./PasteParser";
import { ImageOCR } from "./ImageOCR";
import { QuickAddForm } from "./QuickAddForm";
import { parseFile, guessMapping, applyMapping, detectSourceType, type RawRow } from "../../lib/import-parse";
import { classifyRow } from "../../lib/dedup";
import * as db from "../../lib/db";
import { useContactsStore } from "../../store/contacts";
import { useToast } from "../../hooks/useToast";
import { humanError } from "../../lib/errors";

type Stage = "hub" | "mapping" | "review" | "history";
type SourceTab = "file" | "paste" | "image" | "quick";

interface FileState {
  file: File;
  rows: RawRow[];
  headers: string[];
  mapping: Record<string, string>;
  template: MappingTemplate | null;
}

export function ImportHub() {
  const [stage, setStage] = useState<Stage>("hub");
  const [sourceTab, setSourceTab] = useState<SourceTab>("file");
  const [fileState, setFileState] = useState<FileState | null>(null);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [existingContacts, setExistingContacts] = useState<ContactSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);

  const fetchContacts = useContactsStore((s) => s.fetchContacts);
  const toast = useToast();

  const handleFiles = async (files: File[]) => {
    const file = files[0];
    setLoading(true);
    try {
      const { rows, headers } = await parseFile(file);
      const template = await db.findMatchingTemplate(headers);
      const mapping = template
        ? template.mapping_json
        : guessMapping(headers);
      setFileState({ file, rows, headers, mapping, template });
      setStage("mapping");
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setLoading(false);
    }
  };

  const proceedToReview = async () => {
    if (!fileState) return;
    setLoading(true);
    try {
      const existing = await db.getContacts({ limit: 5000, offset: 0 });
      setExistingContacts(existing);

      const sid = await db.createImportSession(
        detectSourceType(fileState.file.name),
        fileState.file.name
      );
      setSessionId(sid);

      const rows: ImportRow[] = fileState.rows.map((raw, i) => {
        const parsed = applyMapping(raw, fileState.mapping);
        const classification = classifyRow(parsed, existing);
        return {
          row_index: i,
          raw_data: raw,
          parsed,
          issues: classification.issues,
          status: classification.status,
          duplicate_contact_id: classification.duplicate_contact_id,
          action: classification.status === "green" ? "keep" : "discard",
        };
      });
      setImportRows(rows);
      setStage("review");
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setLoading(false);
    }
  };

  const commitImport = async (actions: ImportAction[]) => {
    if (!sessionId || !fileState) return;
    setLoading(true);
    try {
      const parsedContacts = fileState.rows.map((raw) =>
        applyMapping(raw, fileState.mapping)
      );
      const result = await db.commitImport(sessionId, parsedContacts, actions);
      await fetchContacts();
      toast.success(
        `Imported: ${result.added} added, ${result.merged} merged, ${result.discarded} discarded`
      );
      setStage("hub");
      setFileState(null);
      setImportRows([]);
      setSessionId(null);
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setLoading(false);
    }
  };

  const handlePasteParsed = async (parsed: ParsedContact) => {
    const existing = await db.getContacts({ limit: 5000, offset: 0 });
    const classification = classifyRow(parsed, existing);
    const row: ImportRow = {
      row_index: 0,
      raw_data: {},
      parsed,
      issues: classification.issues,
      status: classification.status,
      duplicate_contact_id: classification.duplicate_contact_id,
      action: classification.status === "green" ? "keep" : "discard",
    };
    const sid = await db.createImportSession("paste", "Pasted text");
    setSessionId(sid);
    setExistingContacts(existing);
    setImportRows([row]);
    setFileState({ file: new File([], "paste"), rows: [{}], headers: [], mapping: {}, template: null });
    setStage("review");
  };

  const handleOcrParsed = async (parsed: ParsedContact, confidence: number) => {
    const existing = await db.getContacts({ limit: 5000, offset: 0 });
    const classification = classifyRow(parsed, existing, confidence);
    const row: ImportRow = {
      row_index: 0,
      raw_data: {},
      parsed,
      confidence,
      issues: classification.issues,
      status: classification.status,
      duplicate_contact_id: classification.duplicate_contact_id,
      action: classification.status === "green" ? "keep" : "discard",
    };
    const sid = await db.createImportSession("image", "OCR image");
    setSessionId(sid);
    setExistingContacts(existing);
    setImportRows([row]);
    setFileState({ file: new File([], "image"), rows: [{}], headers: [], mapping: {}, template: null });
    setStage("review");
  };

  if (stage === "mapping" && fileState) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-4 px-6 py-4 border-b border-zinc-800 shrink-0">
          <button onClick={() => setStage("hub")} className="text-xs text-zinc-500 hover:text-zinc-300 font-mono">← Back</button>
          <h2 className="text-sm font-semibold text-zinc-100">Map columns — {fileState.file.name}</h2>
          {fileState.template && (
            <span className="text-xs text-zinc-500 font-mono">Template: {fileState.template.name}</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <ColumnMapper
            headers={fileState.headers}
            mapping={fileState.mapping}
            onChange={(m) => setFileState((s) => s ? { ...s, mapping: m } : s)}
            sampleRow={fileState.rows[0]}
          />
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-800 shrink-0">
          <button
            onClick={proceedToReview}
            disabled={loading}
            className="px-5 py-2 text-sm font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded disabled:opacity-50 transition-colors"
          >
            {loading ? "Processing…" : `Review ${fileState.rows.length} rows →`}
          </button>
        </div>
      </div>
    );
  }

  if (stage === "review") {
    return (
      <ImportReview
        rows={importRows}
        existingContacts={existingContacts}
        onActions={commitImport}
        onBack={() => fileState?.headers.length ? setStage("mapping") : setStage("hub")}
      />
    );
  }

  if (stage === "history") {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-4 px-6 py-4 border-b border-zinc-800 shrink-0">
          <button onClick={() => setStage("hub")} className="text-xs text-zinc-500 hover:text-zinc-300 font-mono">← Back</button>
          <h2 className="text-sm font-semibold text-zinc-100">Import history</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <ImportHistory onRollbackDone={fetchContacts} />
        </div>
      </div>
    );
  }

  // Hub
  const TABS: { id: SourceTab; label: string }[] = [
    { id: "file", label: "File" },
    { id: "paste", label: "Paste text" },
    { id: "image", label: "Image / OCR" },
    { id: "quick", label: "Quick add" },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
        <h2 className="text-sm font-semibold text-zinc-100">Import contacts</h2>
        <button
          onClick={() => setStage("history")}
          className="text-xs text-zinc-500 hover:text-zinc-300 font-mono"
        >
          History →
        </button>
      </div>

      <div className="flex border-b border-zinc-800 px-6 shrink-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSourceTab(t.id)}
            className={`px-4 py-2.5 text-xs font-mono border-b-2 transition-colors ${
              sourceTab === t.id
                ? "border-zinc-200 text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {sourceTab === "file" && (
          loading
            ? <p className="text-xs text-zinc-500 font-mono">Processing…</p>
            : <DropZone onFiles={handleFiles} />
        )}
        {sourceTab === "paste" && <PasteParser onParsed={handlePasteParsed} />}
        {sourceTab === "image" && <ImageOCR onParsed={handleOcrParsed} />}
        {sourceTab === "quick" && <QuickAddForm />}
      </div>
    </div>
  );
}
