import { useState, useEffect } from "react";
import type { ErrorEntry, AppInfo, OcrEngineStatus } from "../../types";
import * as db from "../../lib/db";
import { useUIStore } from "../../store/ui";
import { useToast } from "../../hooks/useToast";
import { humanError } from "../../lib/errors";
import { Modal } from "../common/Modal";

export function DiagnosticsPanel() {
  const open = useUIStore((s) => s.diagnosticsOpen);
  const close = useUIStore((s) => s.closeDiagnostics);
  const toast = useToast();

  const [tab, setTab] = useState<"info" | "errors" | "ocr" | "db">("info");
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [ocrStatus, setOcrStatus] = useState<OcrEngineStatus | null>(null);
  const [integrityResult, setIntegrityResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open) return;
    db.getAppInfo().then(setAppInfo).catch(() => {});
    db.getErrorLog(100).then(setErrors).catch(() => {});
  }, [open]);

  const testOcr = async () => {
    setRunning(true);
    try {
      const status = await db.testOcrEngines();
      setOcrStatus(status);
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setRunning(false);
    }
  };

  const checkIntegrity = async () => {
    setRunning(true);
    try {
      const result = await db.runIntegrityCheck();
      setIntegrityResult(result);
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setRunning(false);
    }
  };

  const vacuum = async () => {
    setRunning(true);
    try {
      await db.vacuumDb();
      toast.success("VACUUM completed");
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setRunning(false);
    }
  };

  const exportBackup = async () => {
    setRunning(true);
    try {
      const path = await db.exportBackup();
      toast.success(`Backup saved to ${path}`);
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Diagnostics (⌘⇧D)" width="max-w-2xl">
      <div className="flex gap-1 mb-4">
        {(["info", "errors", "ocr", "db"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1 text-xs font-mono rounded transition-colors ${
              tab === t ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t === "info" ? "App info" : t === "errors" ? `Errors (${errors.length})` : t === "ocr" ? "OCR" : "Database"}
          </button>
        ))}
      </div>

      {tab === "info" && appInfo && (
        <div className="space-y-1.5 font-mono text-xs">
          <Row label="Version" value={appInfo.app_version} />
          <Row label="Schema version" value={String(appInfo.schema_version)} />
          <Row label="DB path" value={appInfo.db_path} />
          <Row label="Device" value={`${appInfo.device_name} (${appInfo.device_id})`} />
          <Row label="Sync provider" value={appInfo.sync_provider} />
        </div>
      )}

      {tab === "errors" && (
        <div className="max-h-80 overflow-y-auto space-y-2">
          {errors.length === 0 && <p className="text-xs text-zinc-600 font-mono">No errors logged.</p>}
          {errors.map((e) => (
            <div key={e.id} className="bg-zinc-800 rounded p-2.5 text-xs font-mono">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={e.level === "error" ? "text-red-400" : "text-yellow-400"}>{e.level}</span>
                <span className="text-zinc-600">{new Date(e.created_at * 1000).toLocaleString()}</span>
                {e.context && <span className="text-zinc-600">{e.context}</span>}
              </div>
              <p className="text-zinc-300">{e.message}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "ocr" && (
        <div className="space-y-3">
          <button
            onClick={testOcr}
            disabled={running}
            className="px-4 py-1.5 text-sm font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded disabled:opacity-50"
          >
            {running ? "Testing…" : "Test OCR engines"}
          </button>
          {ocrStatus && (
            <div className="font-mono text-xs space-y-1.5">
              <Row label="Apple Vision available" value={ocrStatus.apple_vision_available ? "Yes" : "No"} />
              <Row label="Tesseract available" value={ocrStatus.tesseract_available ? "Yes" : "No"} />
              {ocrStatus.tesseract_path && (
                <Row label="Tesseract path" value={ocrStatus.tesseract_path} />
              )}
            </div>
          )}
        </div>
      )}

      {tab === "db" && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={checkIntegrity}
              disabled={running}
              className="px-4 py-1.5 text-sm font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded disabled:opacity-50"
            >
              Integrity check
            </button>
            <button
              onClick={vacuum}
              disabled={running}
              className="px-4 py-1.5 text-sm font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded disabled:opacity-50"
            >
              VACUUM
            </button>
            <button
              onClick={exportBackup}
              disabled={running}
              className="px-4 py-1.5 text-sm font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded disabled:opacity-50"
            >
              Export backup
            </button>
          </div>
          {integrityResult && (
            <pre className="bg-zinc-800 rounded p-3 text-xs font-mono text-zinc-300 whitespace-pre-wrap">
              {integrityResult}
            </pre>
          )}
        </div>
      )}
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4">
      <span className="text-zinc-600 w-36 shrink-0">{label}</span>
      <span className="text-zinc-300 break-all">{value}</span>
    </div>
  );
}
