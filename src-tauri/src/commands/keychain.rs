use keyring::Entry;

const SERVICE: &str = "freight-crm-anthropic";
const ACCOUNT: &str = "api-key";

fn entry() -> Result<Entry, String> {
    Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Keychain error: {}", e))
}

#[tauri::command]
pub fn store_api_key(key: String) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("API key cannot be empty".to_string());
    }
    entry()?.set_password(&key).map_err(|e| format!("Failed to store key in Keychain: {}", e))
}

#[tauri::command]
pub fn get_api_key_masked() -> Result<Option<String>, String> {
    match entry()?.get_password() {
        Ok(key) if key.len() >= 4 => {
            let last4 = &key[key.len() - 4..];
            Ok(Some(format!("••••••••{}", last4)))
        }
        Ok(_) => Ok(Some("••••••••".to_string())),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Keychain read error: {}", e)),
    }
}

#[tauri::command]
pub fn has_api_key() -> Result<bool, String> {
    match entry()?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("Keychain error: {}", e)),
    }
}

#[tauri::command]
pub fn delete_api_key() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Failed to remove key from Keychain: {}", e)),
    }
}

/// Internal helper — returns the raw key for Claude API calls (never sent to frontend)
pub fn get_raw_api_key() -> Option<String> {
    entry().ok()?.get_password().ok()
}
