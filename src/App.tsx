import { useState, useEffect } from "react";
import { AppShell } from "./components/layout/AppShell";
import { UpdateChecker } from "./components/common/UpdateChecker";
import { StartupCheck } from "./components/common/StartupCheck";
import { LoginScreen } from "./components/common/LoginScreen";
import { DiagnosticsPanel } from "./components/diagnostics/DiagnosticsPanel";
import { QuickCallModal } from "./components/activities/QuickCallModal";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { DashboardView } from "./views/DashboardView";
import { ContactsView } from "./views/ContactsView";
import { ContactDetailView } from "./views/ContactDetailView";
import { ImportView } from "./views/ImportView";
import { SettingsView } from "./views/SettingsView";
import StrategyMap from "./features/strategy-map/StrategyMap";
import { useUIStore } from "./store/ui";
import { useContactsStore } from "./store/contacts";
import { useSync } from "./hooks/useSync";
import { useGlobalKeyboard } from "./hooks/useKeyboard";
import * as db from "./lib/db";
import type { UserProfile } from "./types";

function Views({ activeUser }: { activeUser: UserProfile }) {
  const view = useUIStore((s) => s.activeView);
  switch (view) {
    case "dashboard": return <DashboardView />;
    case "contacts": return <ContactsView />;
    case "contact-detail": return <ContactDetailView />;
    case "import": return <ImportView />;
    case "settings": return <SettingsView activeUser={activeUser} />;
    case "strategy-map":
      return activeUser.id === "francisco" ? <StrategyMap /> : <DashboardView />;
    default: return <DashboardView />;
  }
}

function GlobalShortcuts() {
  const setView = useUIStore((s) => s.setView);
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);
  const openDiagnostics = useUIStore((s) => s.openDiagnostics);
  const openQuickCall = useUIStore((s) => s.openQuickCall);
  const selected = useContactsStore((s) => s.selected);

  useGlobalKeyboard("k", openCommandPalette, { meta: true }, []);
  useGlobalKeyboard("1", () => setView("dashboard"), { meta: true }, []);
  useGlobalKeyboard("2", () => setView("contacts"), { meta: true }, []);
  useGlobalKeyboard("3", () => setView("import"), { meta: true }, []);
  useGlobalKeyboard(",", () => setView("settings"), { meta: true }, []);
  useGlobalKeyboard("D", openDiagnostics, { meta: true, shift: true }, []);
  useGlobalKeyboard(
    "c",
    () => { if (selected) openQuickCall(selected.id); },
    {},
    [selected]
  );

  return null;
}

function SyncPoller() {
  useSync(30_000);
  return null;
}

export default function App() {
  const [activeUser, setActiveUser] = useState<UserProfile | null | undefined>(undefined);

  useEffect(() => {
    db.getActiveUser()
      .then((u) => setActiveUser(u))
      .catch(() => setActiveUser(null));
  }, []);

  if (activeUser === undefined) return null;

  if (activeUser === null) {
    return <LoginScreen onLogin={(u) => setActiveUser(u)} />;
  }

  return (
    <StartupCheck>
      <AppShell activeUser={activeUser} onSwitchUser={() => setActiveUser(null)}>
        <ErrorBoundary><Views activeUser={activeUser} /></ErrorBoundary>
        <DiagnosticsPanel />
        <QuickCallModal activeUser={activeUser} />
        <GlobalShortcuts />
        <SyncPoller />
        <UpdateChecker />
      </AppShell>
    </StartupCheck>
  );
}
