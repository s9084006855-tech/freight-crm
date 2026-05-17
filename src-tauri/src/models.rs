use serde::{Deserialize, Serialize};

// ── Contact ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContactSummary {
    pub id: i64,
    pub company_name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub roles: Option<String>,
    pub status: String,
    pub priority: i32,
    pub last_contacted_at: Option<i64>,
    pub has_follow_up: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContactDetail {
    pub id: i64,
    pub bbid: Option<String>,
    pub company_name: String,
    pub phone: Option<String>,
    pub fax: Option<String>,
    pub email: Option<String>,
    pub website: Option<String>,
    pub street: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
    pub country: Option<String>,
    pub roles: Option<String>,
    pub commodities: Option<String>,
    pub status: String,
    pub priority: i32,
    pub source: String,
    pub notes: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_contacted_at: Option<i64>,
    pub people: Vec<ContactPerson>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContactPerson {
    pub id: i64,
    pub contact_id: i64,
    pub name: String,
    pub title: Option<String>,
    pub phone: Option<String>,
    pub mobile: Option<String>,
    pub email: Option<String>,
    pub is_primary: bool,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateContactData {
    pub bbid: Option<String>,
    pub company_name: String,
    pub phone: Option<String>,
    pub fax: Option<String>,
    pub email: Option<String>,
    pub website: Option<String>,
    pub street: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
    pub country: Option<String>,
    pub roles: Option<String>,
    pub commodities: Option<String>,
    pub status: Option<String>,
    pub priority: Option<i32>,
    pub source: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateContactData {
    pub company_name: Option<String>,
    pub phone: Option<String>,
    pub fax: Option<String>,
    pub email: Option<String>,
    pub website: Option<String>,
    pub street: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
    pub country: Option<String>,
    pub roles: Option<String>,
    pub commodities: Option<String>,
    pub status: Option<String>,
    pub priority: Option<i32>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContactFilter {
    pub search: Option<String>,
    pub state: Option<String>,
    pub status: Option<String>,
    pub priority: Option<i32>,
    pub role: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub sort_by: Option<String>,
    pub sort_desc: Option<bool>,
}

// ── Activity ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Activity {
    pub id: i64,
    pub contact_id: i64,
    pub activity_type: String,
    pub outcome: Option<String>,
    pub notes: Option<String>,
    pub duration_sec: Option<i64>,
    pub follow_up_at: Option<i64>,
    pub follow_up_done: bool,
    pub created_at: i64,
    pub user_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateActivityData {
    pub contact_id: i64,
    pub activity_type: String,
    pub outcome: Option<String>,
    pub notes: Option<String>,
    pub duration_sec: Option<i64>,
    pub follow_up_at: Option<i64>,
    pub user_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FollowUpItem {
    pub activity_id: i64,
    pub contact_id: i64,
    pub company_name: String,
    pub phone: Option<String>,
    pub state: Option<String>,
    pub follow_up_at: i64,
    pub notes: Option<String>,
    pub overdue: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DashboardStats {
    pub total_contacts: i64,
    pub calls_today: i64,
    pub calls_this_week: i64,
    pub follow_ups_due_today: i64,
    pub follow_ups_overdue: i64,
    pub contacts_by_state: Vec<StateCount>,
    pub recent_activities: Vec<Activity>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StateCount {
    pub state: String,
    pub count: i64,
}

// ── Import ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ImportSession {
    pub id: i64,
    pub source_type: String,
    pub source_name: Option<String>,
    pub started_at: i64,
    pub completed_at: Option<i64>,
    pub contacts_added: i64,
    pub contacts_merged: i64,
    pub contacts_discarded: i64,
    pub status: String,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ParsedContact {
    pub company_name: Option<String>,
    pub phone: Option<String>,
    pub fax: Option<String>,
    pub email: Option<String>,
    pub website: Option<String>,
    pub street: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
    pub roles: Option<String>,
    pub commodities: Option<String>,
    pub contact_name: Option<String>,
    pub contact_title: Option<String>,
    pub contact_phone: Option<String>,
    pub contact_email: Option<String>,
    pub bbid: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportAction {
    pub row_index: i32,
    pub action: String, // keep|merge|discard
    pub merge_contact_id: Option<i64>,
    pub merge_fields: Option<serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ImportResult {
    pub session_id: i64,
    pub added: i64,
    pub merged: i64,
    pub discarded: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MappingTemplate {
    pub id: i64,
    pub name: String,
    pub source_type: String,
    pub mapping_json: serde_json::Value,
    pub header_fingerprint: Option<String>,
    pub sample_headers: Option<Vec<String>>,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
}

// ── OCR ───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct OcrResult {
    pub text: String,
    pub confidence: f64,
    pub engine: String,
    pub low_confidence: bool,
    // Structured fields populated by Claude Vision extraction (may be empty for raw OCR engines)
    #[serde(default)]
    pub extracted: Option<ExtractedContact>,
}

#[derive(Debug, Serialize, Deserialize, Default, Clone)]
pub struct ExtractedContact {
    pub company_name: Option<String>,
    pub contact_name: Option<String>,
    pub contact_title: Option<String>,
    pub phone: Option<String>,
    pub phones: Vec<String>,
    pub email: Option<String>,
    pub emails: Vec<String>,
    pub website: Option<String>,
    pub address: Option<String>,
    pub city: Option<String>,
    pub state: Option<String>,
    pub zip: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct OcrEngineStatus {
    pub apple_vision_available: bool,
    pub tesseract_available: bool,
    pub claude_vision_available: bool,
    pub tesseract_path: Option<String>,
    pub vision_helper_path: Option<String>,
    pub last_test_result: Option<String>,
}

// ── Sync ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct SyncStatus {
    pub status: String, // green|red|setup_required
    pub last_device_name: Option<String>,
    pub this_device_id: String,
    pub this_device_name: String,
    pub sync_path: String, // turso URL
}

// ── Diagnostics ───────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct ErrorEntry {
    pub id: i64,
    pub level: String,
    pub context: Option<String>,
    pub message: String,
    pub device_id: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppInfo {
    pub app_version: String,
    pub schema_version: i64,
    pub device_id: String,
    pub device_name: String,
    pub turso_url: String,
}

// ── Enrichment ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EnrichmentResult {
    pub contact_id: i64,
    pub company_name: String,
    pub commodities: Vec<String>,
    pub role: Option<String>,
    pub shipping_lanes: Vec<String>,
    pub key_contact_title: Option<String>,
    pub website: Option<String>,
    pub annual_volume_estimate: Option<String>,
    pub profile_notes: Option<String>,
    pub cold_call_script: String,
    pub web_searched: bool,
    pub error: Option<String>,
}

// ── Startup ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct StartupCheck {
    pub name: String,
    pub passed: bool,
    pub message: String,
    pub can_auto_repair: bool,
    pub repair_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StartupCheckResult {
    pub all_passed: bool,
    pub checks: Vec<StartupCheck>,
}
