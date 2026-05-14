import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { motion, AnimatePresence } from "framer-motion";
import { Download, RefreshCw } from "lucide-react";

export function UpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [version, setVersion] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    // Check for update 3 seconds after app starts, silently
    const timer = setTimeout(async () => {
      try {
        const update = await check();
        if (update?.available) {
          setVersion(update.version);
          setUpdateAvailable(true);
        }
      } catch {
        // No internet or no update endpoint — ignore silently
      }
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  const installUpdate = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const update = await check();
      if (!update?.available) return;

      let downloadedBytes = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setTotal(event.data.contentLength ?? 0);
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          setDownloaded(downloadedBytes);
          if (total > 0) setProgress(Math.round((downloadedBytes / total) * 100));
        } else if (event.event === "Finished") {
          setProgress(100);
        }
      });

      // Relaunch into the new version
      await relaunch();
    } catch {
      setDownloading(false);
    }
  };

  return (
    <AnimatePresence>
      {updateAvailable && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          className="fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl"
          style={{
            background: "rgba(15,15,25,0.95)",
            border: "1px solid rgba(99,102,241,0.4)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 8px 32px rgba(99,102,241,0.2)",
            minWidth: 260,
          }}
        >
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(99,102,241,0.15)" }}
          >
            {downloading ? (
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
                <RefreshCw size={14} color="#a5b4fc" />
              </motion.div>
            ) : (
              <Download size={14} color="#a5b4fc" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            {downloading ? (
              <>
                <p className="text-xs font-medium" style={{ color: "#f0f0f5" }}>
                  Installing v{version}…
                </p>
                <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "linear-gradient(90deg, #6366f1, #8b5cf6)" }}
                    animate={{ width: `${progress || 5}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <p className="text-xs mt-1" style={{ color: "#6b6b8a" }}>
                  {total > 0
                    ? `${(downloaded / 1024 / 1024).toFixed(1)} / ${(total / 1024 / 1024).toFixed(1)} MB`
                    : "Downloading…"}
                </p>
              </>
            ) : (
              <>
                <p className="text-xs font-medium" style={{ color: "#f0f0f5" }}>
                  Update available — v{version}
                </p>
                <p className="text-xs" style={{ color: "#6b6b8a" }}>
                  App will restart automatically
                </p>
              </>
            )}
          </div>

          {!downloading && (
            <button
              onClick={installUpdate}
              className="text-xs font-mono px-3 py-1.5 rounded-lg shrink-0"
              style={{
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "#fff",
              }}
            >
              Install
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
