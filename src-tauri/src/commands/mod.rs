pub mod activities;
pub mod contacts;
pub mod diagnostics;
pub mod import;
pub mod keychain;
pub mod ocr;
pub mod settings;
pub mod startup;
pub mod sync;

pub fn normalize_company(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn normalize_phone(phone: &str) -> String {
    phone.chars().filter(|c| c.is_ascii_digit()).collect()
}

pub fn conn_err() -> String {
    "Database not initialized. Run startup check to diagnose.".to_string()
}
