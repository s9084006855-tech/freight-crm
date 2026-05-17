import { invoke } from "@tauri-apps/api/core";
import type {
  Activity,
  AppInfo,
  ContactDetail,
  ContactFilter,
  ContactSummary,
  CreateActivityData,
  CreateContactData,
  DashboardStats,
  EnrichmentResult,
  ErrorEntry,
  ExtractedContact,
  FollowUpItem,
  ImportAction,
  ImportResult,
  ImportSession,
  MappingTemplate,
  OcrEngineStatus,
  OcrResult,
  ParsedContact,
  StartupCheckResult,
  SyncStatus,
  UserProfile,
} from "../types";

// ── Contacts ──────────────────────────────────────────────────────────

export const getContacts = (filter: ContactFilter) =>
  invoke<ContactSummary[]>("get_contacts", { filter });

export const getContact = (id: number) =>
  invoke<ContactDetail>("get_contact", { id });

export const createContact = (data: CreateContactData) =>
  invoke<ContactSummary>("create_contact", { data });

export const updateContact = (id: number, data: Partial<CreateContactData>) =>
  invoke<ContactSummary>("update_contact", { id, data });

export const deleteContact = (id: number) =>
  invoke<void>("delete_contact", { id });

export const searchContacts = (query: string, limit?: number) =>
  invoke<ContactSummary[]>("search_contacts", { query, limit });

// ── Activities ────────────────────────────────────────────────────────

export const logActivity = (data: CreateActivityData) =>
  invoke<Activity>("log_activity", { data });

export const getActivities = (contactId: number) =>
  invoke<Activity[]>("get_activities", { contactId });

export const getFollowUps = () => invoke<FollowUpItem[]>("get_follow_ups");

export const markFollowUpDone = (id: number) =>
  invoke<void>("mark_follow_up_done", { id });

export const getDashboardStats = () =>
  invoke<DashboardStats>("get_dashboard_stats");

// ── Import ────────────────────────────────────────────────────────────

export const createImportSession = (sourceType: string, sourceName?: string) =>
  invoke<number>("create_import_session", { sourceType, sourceName });

export const commitImport = (
  sessionId: number,
  rows: ParsedContact[],
  actions: ImportAction[]
) => invoke<ImportResult>("commit_import", { sessionId, rows, actions });

export const rollbackImport = (sessionId: number) =>
  invoke<void>("rollback_import", { sessionId });

export const getImportSessions = () =>
  invoke<ImportSession[]>("get_import_sessions");

export const getMappingTemplates = () =>
  invoke<MappingTemplate[]>("get_mapping_templates");

export const saveMappingTemplate = (
  name: string,
  sourceType: string,
  mapping: Record<string, string>,
  headers: string[]
) => invoke<MappingTemplate>("save_mapping_template", { name, sourceType, mapping, headers });

export const deleteMappingTemplate = (id: number) =>
  invoke<void>("delete_mapping_template", { id });

export const findMatchingTemplate = (headers: string[]) =>
  invoke<MappingTemplate | null>("find_matching_template", { headers });

// ── OCR ───────────────────────────────────────────────────────────────

export const ocrImage = (imagePath: string) =>
  invoke<OcrResult>("ocr_image", { imagePath });

export const ocrImageClaude = (imageBase64: string, mediaType: string) =>
  invoke<OcrResult>("ocr_image_claude", { imageBase64, mediaType });

export const ocrPdfClaude = (pdfBase64: string, chunkSize?: number) =>
  invoke<ExtractedContact[]>("ocr_pdf_claude", { pdfBase64, chunkSize });

export const testOcrEngines = () =>
  invoke<OcrEngineStatus>("test_ocr_engines");

// ── Sync ──────────────────────────────────────────────────────────────

export const getSyncStatus = () => invoke<SyncStatus>("get_sync_status");

// ── Diagnostics ───────────────────────────────────────────────────────

export const getErrorLog = (limit?: number) =>
  invoke<ErrorEntry[]>("get_error_log", { limit });

export const exportBackup = () => invoke<string>("export_backup");

export const getAppInfo = () => invoke<AppInfo>("get_app_info");

// ── Settings ──────────────────────────────────────────────────────────

export const getSettings = () =>
  invoke<Record<string, string>>("get_settings");

export const updateSetting = (key: string, value: string) =>
  invoke<void>("update_setting", { key, value });

export const connectTurso = (url: string, token: string) =>
  invoke<void>("connect_turso", { url, token });

export const migrateLocalToTurso = (sqlitePath: string) =>
  invoke<string>("migrate_local_to_turso", { sqlitePath });

// ── Keychain ──────────────────────────────────────────────────────────

export const storeApiKey = (key: string) =>
  invoke<void>("store_api_key", { key });

export const getApiKeyMasked = () =>
  invoke<string | null>("get_api_key_masked");

export const hasApiKey = () => invoke<boolean>("has_api_key");

export const deleteApiKey = () => invoke<void>("delete_api_key");

// ── Startup ───────────────────────────────────────────────────────────

export const runStartupCheck = () =>
  invoke<StartupCheckResult>("run_startup_check");

// ── Users ─────────────────────────────────────────────────────────────

export const getUsers = () => invoke<UserProfile[]>("get_users");

export const getActiveUser = () => invoke<UserProfile | null>("get_active_user");

export const setActiveUser = (userId: string) =>
  invoke<UserProfile>("set_active_user", { userId });

// ── Enrichment ────────────────────────────────────────────────────────

export const enrichContact = (contactId: number) =>
  invoke<EnrichmentResult>("enrich_contact", { contactId });

export const enrichAllContacts = () =>
  invoke<EnrichmentResult[]>("enrich_all_contacts");
