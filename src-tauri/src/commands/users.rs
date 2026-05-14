use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserProfile {
    pub id: String,
    pub display_name: String,
    pub initials: String,
    pub color: String,
}

pub fn all_users() -> Vec<UserProfile> {
    vec![
        UserProfile {
            id: "francisco".to_string(),
            display_name: "Francisco Pelaez".to_string(),
            initials: "FP".to_string(),
            color: "#6366f1".to_string(),
        },
        UserProfile {
            id: "jack".to_string(),
            display_name: "Jack Scopetta".to_string(),
            initials: "JS".to_string(),
            color: "#06b6d4".to_string(),
        },
    ]
}

#[tauri::command]
pub fn get_users() -> Vec<UserProfile> {
    all_users()
}

#[tauri::command]
pub fn get_active_user(state: State<'_, AppState>) -> Option<UserProfile> {
    let cfg = state.local_cfg.lock().ok()?;
    let user_id = cfg.active_user.clone()?;
    all_users().into_iter().find(|u| u.id == user_id)
}

#[tauri::command]
pub fn set_active_user(state: State<'_, AppState>, user_id: String) -> Result<UserProfile, String> {
    let user = all_users()
        .into_iter()
        .find(|u| u.id == user_id)
        .ok_or_else(|| format!("Unknown user: {}", user_id))?;

    let mut cfg = state.local_cfg.lock().map_err(|e| e.to_string())?;
    cfg.active_user = Some(user_id);
    let json = serde_json::to_string_pretty(&*cfg).map_err(|e| e.to_string())?;
    std::fs::write(&state.local_cfg_path, json).map_err(|e| e.to_string())?;

    Ok(user)
}
