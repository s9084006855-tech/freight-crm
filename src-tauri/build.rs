use std::env;
use std::fs;
use std::path::Path;
use std::process::Command;

fn main() {
    tauri_build::build();
    compile_swift_vision_helper();
}

fn compile_swift_vision_helper() {
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let swift_src = format!("{}/swift/vision_ocr.swift", manifest_dir);
    let resources_dir = format!("{}/resources", manifest_dir);
    let output_path = format!("{}/vision_ocr", resources_dir);

    if !Path::new(&swift_src).exists() {
        println!(
            "cargo:warning=Swift Vision helper not found at {}. Apple Vision OCR unavailable.",
            swift_src
        );
        return;
    }

    // Skip recompile if binary is already newer than source
    if Path::new(&output_path).exists() {
        let src_time = fs::metadata(&swift_src).and_then(|m| m.modified()).ok();
        let out_time = fs::metadata(&output_path).and_then(|m| m.modified()).ok();
        if let (Some(s), Some(o)) = (src_time, out_time) {
            if o >= s {
                println!("cargo:rerun-if-changed={}", swift_src);
                return;
            }
        }
    }

    fs::create_dir_all(&resources_dir).ok();

    let status = Command::new("swiftc")
        .args([
            &swift_src,
            "-o",
            &output_path,
            "-O",
            "-framework", "Vision",
            "-framework", "AppKit",
            "-framework", "CoreImage",
            "-framework", "CoreGraphics",
        ])
        .status();

    match status {
        Ok(s) if s.success() => {
            println!("cargo:rerun-if-changed={}", swift_src);
            println!("cargo:warning=Swift Vision OCR helper compiled successfully.");
        }
        Ok(s) => {
            println!(
                "cargo:warning=swiftc exited with {}. Apple Vision OCR unavailable.",
                s
            );
        }
        Err(e) => {
            println!(
                "cargo:warning=Could not run swiftc: {}. Apple Vision OCR unavailable.",
                e
            );
        }
    }
}
