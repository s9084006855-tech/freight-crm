import { useState, useEffect } from "react";
import * as db from "../lib/db";
import { useToast } from "../hooks/useToast";
import { humanError } from "../lib/errors";

export function SettingsView() {
  const toast = useToast();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [apiKeyMasked, setApiKeyMasked] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [syncPath, setSyncPath] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    db.getSettings().then(setSettings).catch(() => {});
    db.getApiKeyMasked().then(setApiKeyMasked).catch(() => {});
  }, []);

  useEffect(() => {
    setSyncPath(settings.sync_path ?? "");
    setDeviceName(settings.device_name ?? "");
  }, [settings]);

  const saveSetting = async (key: string, value: string) => {
    setSaving(key);
    try {
      await db.updateSetting(key, value);
      setSettings((s) => ({ ...s, [key]: value }));
      toast.success("Saved");
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setSaving(null);
    }
  };

  const saveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setSaving("api_key");
    try {
      await db.storeApiKey(apiKeyInput.trim());
      const masked = await db.getApiKeyMasked();
      setApiKeyMasked(masked);
      setApiKeyInput("");
      toast.success("API key saved to Keychain");
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setSaving(null);
    }
  };

  const deleteApiKey = async () => {
    setSaving("api_key");
    try {
      await db.deleteApiKey();
      setApiKeyMasked(null);
      toast.success("API key removed");
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-sm font-semibold text-zinc-100 mb-6">Settings</h1>

      <div className="space-y-8 max-w-lg">
        {/* Sync path */}
        <section>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">iCloud sync path</h2>
          <p className="text-xs text-zinc-600 mb-3">
            Path to your iCloud Drive folder where the database is stored. Leave blank to use the default (~/ iCloud Drive/FreightCRM/).
          </p>
          <div className="flex gap-2">
            <input
              value={syncPath}
              onChange={(e) => setSyncPath(e.target.value)}
              placeholder="~/Library/Mobile Documents/com~apple~CloudDocs/FreightCRM/"
              className="flex-1 h-8 px-2.5 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500"
            />
            <button
              onClick={() => saveSetting("sync_path", syncPath)}
              disabled={saving === "sync_path"}
              className="px-3 py-1.5 text-xs font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </section>

        {/* Device name */}
        <section>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Device name</h2>
          <div className="flex gap-2">
            <input
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              className="flex-1 h-8 px-2.5 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500"
            />
            <button
              onClick={() => saveSetting("device_name", deviceName)}
              disabled={saving === "device_name"}
              className="px-3 py-1.5 text-xs font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </section>

        {/* Anthropic API key */}
        <section>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Anthropic API key</h2>
          <p className="text-xs text-zinc-600 mb-3">
            Stored in macOS Keychain. Used for "Enhance with Claude" in paste import (~$0.001/request).
          </p>
          {apiKeyMasked ? (
            <div className="flex items-center gap-3">
              <span className="text-sm font-mono text-zinc-400">{apiKeyMasked}</span>
              <button
                onClick={deleteApiKey}
                disabled={saving === "api_key"}
                className="text-xs text-red-400 hover:text-red-300 font-mono"
              >
                Remove
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                type="password"
                placeholder="sk-ant-…"
                className="flex-1 h-8 px-2.5 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500"
              />
              <button
                onClick={saveApiKey}
                disabled={!apiKeyInput.trim() || saving === "api_key"}
                className="px-3 py-1.5 text-xs font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded disabled:opacity-50"
              >
                {saving === "api_key" ? "Saving…" : "Save"}
              </button>
            </div>
          )}
        </section>

        {/* Claude auto-enhance toggle */}
        <section>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Claude paste enhancement</h2>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.claude_auto_enhance === "true"}
              onChange={(e) => saveSetting("claude_auto_enhance", String(e.target.checked))}
              className="rounded"
            />
            <span className="text-sm text-zinc-300">
              Automatically enhance pasted text with Claude (default: off)
            </span>
          </label>
          <p className="text-xs text-zinc-600 mt-1.5">
            When on, paste import automatically calls Claude API. When off, you can trigger it manually per paste.
          </p>
        </section>
      </div>
    </div>
  );
}
