// ── Contact ───────────────────────────────────────────────────────────

export interface ContactSummary {
  id: number;
  company_name: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  roles?: string;
  status: string;
  priority: number;
  last_contacted_at?: number;
  has_follow_up: boolean;
}

export interface ContactDetail {
  id: number;
  bbid?: string;
  company_name: string;
  phone?: string;
  fax?: string;
  email?: string;
  website?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  roles?: string;
  commodities?: string;
  status: string;
  priority: number;
  source: string;
  notes?: string;
  created_at: number;
  updated_at: number;
  last_contacted_at?: number;
  people: ContactPerson[];
}

export interface ContactPerson {
  id: number;
  contact_id: number;
  name: string;
  title?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  is_primary: boolean;
  notes?: string;
}

export interface ContactFilter {
  search?: string;
  state?: string;
  status?: string;
  priority?: number;
  role?: string;
  limit?: number;
  offset?: number;
  sort_by?: "name" | "last_contacted" | "state" | "priority";
  sort_desc?: boolean;
}

export interface CreateContactData {
  company_name: string;
  phone?: string;
  fax?: string;
  email?: string;
  website?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  roles?: string;
  commodities?: string;
  status?: string;
  priority?: number;
  source?: string;
  notes?: string;
  bbid?: string;
}

// ── Activity ──────────────────────────────────────────────────────────

export interface Activity {
  id: number;
  contact_id: number;
  activity_type: string;
  outcome?: string;
  notes?: string;
  duration_sec?: number;
  follow_up_at?: number;
  follow_up_done: boolean;
  created_at: number;
  user_id?: string;
}

export interface CreateActivityData {
  contact_id: number;
  activity_type: string;
  outcome?: string;
  notes?: string;
  duration_sec?: number;
  follow_up_at?: number;
  user_id?: string;
}

export interface FollowUpItem {
  activity_id: number;
  contact_id: number;
  company_name: string;
  phone?: string;
  state?: string;
  follow_up_at: number;
  notes?: string;
  overdue: boolean;
}

export interface DashboardStats {
  total_contacts: number;
  calls_today: number;
  calls_this_week: number;
  follow_ups_due_today: number;
  follow_ups_overdue: number;
  contacts_by_state: { state: string; count: number }[];
  recent_activities: Activity[];
}

// ── Import ────────────────────────────────────────────────────────────

export interface ImportSession {
  id: number;
  source_type: string;
  source_name?: string;
  started_at: number;
  completed_at?: number;
  contacts_added: number;
  contacts_merged: number;
  contacts_discarded: number;
  status: string;
  notes?: string;
}

export interface ParsedContact {
  company_name?: string;
  phone?: string;
  fax?: string;
  email?: string;
  website?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  roles?: string;
  commodities?: string;
  contact_name?: string;
  contact_title?: string;
  contact_phone?: string;
  contact_email?: string;
  bbid?: string;
  notes?: string;
}

export type ImportRowStatus = "green" | "yellow" | "red";

export interface ImportRow {
  row_index: number;
  raw_data: Record<string, unknown>;
  parsed: ParsedContact;
  confidence?: number;
  issues: string[];
  status: ImportRowStatus;
  duplicate_contact_id?: number;
  action: "keep" | "merge" | "discard";
}

export interface ImportAction {
  row_index: number;
  action: "keep" | "merge" | "discard";
  merge_contact_id?: number;
  merge_fields?: Record<string, boolean>;
}

export interface ImportResult {
  added: number;
  merged: number;
  discarded: number;
}

export interface MappingTemplate {
  id: number;
  name: string;
  source_type: string;
  mapping_json: Record<string, string>;
  header_fingerprint?: string;
  sample_headers?: string[];
  created_at: number;
  last_used_at?: number;
}

// ── OCR ───────────────────────────────────────────────────────────────

export interface ExtractedContact {
  company_name?: string;
  contact_name?: string;
  contact_title?: string;
  phone?: string;
  phones: string[];
  email?: string;
  emails: string[];
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface OcrResult {
  text: string;
  confidence: number;
  engine: string;
  low_confidence: boolean;
  extracted?: ExtractedContact;
}

export interface OcrEngineStatus {
  apple_vision_available: boolean;
  tesseract_available: boolean;
  claude_vision_available: boolean;
  tesseract_path?: string;
  vision_helper_path?: string;
  last_test_result?: string;
}

// ── Sync ──────────────────────────────────────────────────────────────

export type SyncStatusColor = "green" | "yellow" | "red";

export interface SyncStatus {
  status: SyncStatusColor;
  last_device_name?: string;
  this_device_id: string;
  this_device_name: string;
  sync_path: string;
}

// ── Diagnostics ───────────────────────────────────────────────────────

export interface ErrorEntry {
  id: number;
  level: string;
  context?: string;
  message: string;
  device_id?: string;
  created_at: number;
}

export interface AppInfo {
  app_version: string;
  schema_version: number;
  device_id: string;
  device_name: string;
  turso_url: string;
}

// ── Startup ───────────────────────────────────────────────────────────

export interface StartupCheck {
  name: string;
  passed: boolean;
  message: string;
  can_auto_repair: boolean;
  repair_key?: string;
}

export interface StartupCheckResult {
  all_passed: boolean;
  checks: StartupCheck[];
}

// ── Users ─────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  display_name: string;
  initials: string;
  color: string;
}

export interface EnrichmentResult {
  contact_id: number;
  company_name: string;
  // Web-researched profile fields
  commodities: string[];
  role?: string;
  shipping_lanes: string[];
  key_contact_title?: string;
  website?: string;
  annual_volume_estimate?: string;
  profile_notes?: string;
  // Cold call script
  cold_call_script: string;
  // Meta
  web_searched: boolean;
  error?: string;
}

// ── UI ────────────────────────────────────────────────────────────────

export type ViewName = "dashboard" | "contacts" | "contact-detail" | "import" | "settings" | "strategy-map";
