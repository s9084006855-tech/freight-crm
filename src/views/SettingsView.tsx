import { useState, useEffect } from "react";
import { Eye, EyeOff } from "lucide-react";
import * as db from "../lib/db";
import { useToast } from "../hooks/useToast";
import { humanError } from "../lib/errors";
import { USERS, getProfilePasswords, setProfilePassword } from "../components/common/LoginScreen";
import type { UserProfile } from "../types";

export function SettingsView({ activeUser }: { activeUser: UserProfile }) {
  const toast = useToast();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [apiKeyMasked, setApiKeyMasked] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [tursoUrl, setTursoUrl] = useState("");
  const [tursoToken, setTursoToken] = useState("");
  const [migratePath, setMigratePath] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    db.getSettings().then(setSettings).catch(() => {});
    db.getApiKeyMasked().then(setApiKeyMasked).catch(() => {});
  }, []);

  useEffect(() => {
    setDeviceName(settings.device_name ?? "");
    setTursoUrl(settings.turso_url ?? "");
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

  const connectTurso = async () => {
    if (!tursoUrl.trim() || !tursoToken.trim()) {
      toast.error("Both URL and token are required");
      return;
    }
    setSaving("turso");
    try {
      await db.connectTurso(tursoUrl.trim(), tursoToken.trim());
      const fresh = await db.getSettings();
      setSettings(fresh);
      toast.success("Connected to Turso — database ready");
    } catch (e) {
      toast.error(humanError(e));
    } finally {
      setSaving(null);
    }
  };

  const migrateToTurso = async () => {
    if (!migratePath.trim()) {
      toast.error("Enter the path to your local SQLite file");
      return;
    }
    setSaving("migrate");
    try {
      const msg = await db.migrateLocalToTurso(migratePath.trim());
      toast.success(msg);
      setMigratePath("");
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
        {/* Turso database */}
        <section>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Turso database</h2>
          <p className="text-xs text-zinc-600 mb-3">
            Cloud database — syncs instantly across all your devices. Get your URL and token from{" "}
            <span className="text-zinc-400">turso.tech</span> after creating a database.
          </p>
          {settings.turso_url && (
            <p className="text-xs font-mono text-emerald-500 mb-3">
              Connected: {settings.turso_url}
            </p>
          )}
          <div className="space-y-2">
            <input
              value={tursoUrl}
              onChange={(e) => setTursoUrl(e.target.value)}
              placeholder="libsql://your-db.turso.io"
              className="w-full h-8 px-2.5 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500"
            />
            <div className="flex gap-2">
              <input
                value={tursoToken}
                onChange={(e) => setTursoToken(e.target.value)}
                type="password"
                placeholder="eyJhbGci… (auth token)"
                className="flex-1 h-8 px-2.5 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500"
              />
              <button
                onClick={connectTurso}
                disabled={saving === "turso"}
                className="px-3 py-1.5 text-xs font-mono bg-indigo-700 hover:bg-indigo-600 text-white rounded disabled:opacity-50"
              >
                {saving === "turso" ? "Connecting…" : "Connect"}
              </button>
            </div>
          </div>
        </section>

        {/* One-time migration */}
        <section>
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Migrate from local SQLite</h2>
          <p className="text-xs text-zinc-600 mb-3">
            One-time import of contacts from your old Dropbox/iCloud SQLite file into Turso. Run once per device.
          </p>
          <div className="flex gap-2">
            <input
              value={migratePath}
              onChange={(e) => setMigratePath(e.target.value)}
              placeholder="/Users/you/Dropbox/FreightCRM/freight_crm.sqlite"
              className="flex-1 h-8 px-2.5 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-zinc-100 outline-none focus:border-zinc-500"
            />
            <button
              onClick={migrateToTurso}
              disabled={saving === "migrate"}
              className="px-3 py-1.5 text-xs font-mono bg-zinc-700 hover:bg-zinc-600 text-zinc-100 rounded disabled:opacity-50"
            >
              {saving === "migrate" ? "Migrating…" : "Migrate"}
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

        {/* Profile passwords — admin only */}
        {activeUser.id === "francisco" && (
          <ProfilePasswordsSection />
        )}
      </div>
    </div>
  );
}

function ProfilePasswordsSection() {
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setPasswords(getProfilePasswords());
  }, []);

  const save = (userId: string) => {
    const newPw = editing[userId] ?? "";
    setProfilePassword(userId, newPw);
    setPasswords(getProfilePasswords());
    setEditing((e) => { const n = { ...e }; delete n[userId]; return n; });
  };

  const clear = (userId: string) => {
    setProfilePassword(userId, "");
    setPasswords(getProfilePasswords());
    setEditing((e) => { const n = { ...e }; delete n[userId]; return n; });
  };

  return (
    <section>
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Profile passwords</h2>
      <p className="text-xs text-zinc-600 mb-3">
        Require a password when switching to each profile. Stored locally on this device.
      </p>
      <div className="space-y-3">
        {USERS.map((user) => {
          const currentPw = passwords[user.id] || "";
          const isEditing = user.id in editing;
          const show = visible[user.id] ?? false;
          return (
            <div key={user.id} className="flex items-center gap-3 p-3 rounded-xl"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold text-white shrink-0"
                style={{ background: user.color }}
              >
                {user.initials}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-zinc-300">{user.display_name}</p>
                {isEditing ? (
                  <div className="flex gap-1.5 mt-1.5">
                    <div className="relative flex-1">
                      <input
                        autoFocus
                        type={show ? "text" : "password"}
                        value={editing[user.id]}
                        onChange={(e) => setEditing((prev) => ({ ...prev, [user.id]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter") save(user.id); if (e.key === "Escape") setEditing((prev) => { const n = { ...prev }; delete n[user.id]; return n; }); }}
                        placeholder="New password (blank = no password)"
                        className="w-full h-7 px-2 pr-7 text-xs font-mono rounded-lg outline-none"
                        style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "#f0f0f5" }}
                      />
                      <button onClick={() => setVisible((v) => ({ ...v, [user.id]: !show }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-80">
                        {show ? <EyeOff size={11} color="#8b8ba8" /> : <Eye size={11} color="#8b8ba8" />}
                      </button>
                    </div>
                    <button onClick={() => save(user.id)} className="px-2 py-1 text-xs rounded-lg"
                      style={{ background: "rgba(99,102,241,0.2)", color: "#a5b4fc" }}>Save</button>
                    <button onClick={() => setEditing((prev) => { const n = { ...prev }; delete n[user.id]; return n; })}
                      className="px-2 py-1 text-xs rounded-lg"
                      style={{ background: "rgba(255,255,255,0.05)", color: "#6b6b8a" }}>Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mt-0.5">
                    {currentPw ? (
                      <>
                        <span className="text-xs font-mono" style={{ color: "#6b6b8a" }}>
                          {show ? currentPw : "••••••••"}
                        </span>
                        <button onClick={() => setVisible((v) => ({ ...v, [user.id]: !show }))}
                          className="opacity-40 hover:opacity-70">
                          {show ? <EyeOff size={10} color="#8b8ba8" /> : <Eye size={10} color="#8b8ba8" />}
                        </button>
                      </>
                    ) : (
                      <span className="text-xs" style={{ color: "#4a4a65" }}>No password</span>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-1.5 shrink-0">
                {!isEditing && (
                  <button
                    onClick={() => setEditing((prev) => ({ ...prev, [user.id]: currentPw }))}
                    className="px-2 py-1 text-xs rounded-lg"
                    style={{ background: "rgba(255,255,255,0.06)", color: "#8b8ba8" }}
                  >
                    {currentPw ? "Change" : "Set"}
                  </button>
                )}
                {currentPw && !isEditing && (
                  <button onClick={() => clear(user.id)} className="px-2 py-1 text-xs rounded-lg"
                    style={{ background: "rgba(239,68,68,0.1)", color: "#f87171" }}>Remove</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
