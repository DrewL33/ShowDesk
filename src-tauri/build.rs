fn main() {
    println!("cargo:rerun-if-env-changed=SHOWDESK_CHANNEL");
    let channel = std::env::var("SHOWDESK_CHANNEL").unwrap_or_else(|_| "stable".to_string());
    println!("cargo:rustc-env=SHOWDESK_CHANNEL={channel}");
    tauri_build::build()
}
