#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::UpdaterExt;

struct AtemService(Mutex<Option<Child>>);

#[tauri::command]
async fn check_for_update(app: AppHandle) -> Result<serde_json::Value, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(match update {
        Some(update) => serde_json::json!({
            "available": true,
            "version": update.version.to_string(),
            "date": update.date.map(|date| date.to_string()),
            "body": update.body
        }),
        None => serde_json::json!({ "available": false })
    })
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?
        .ok_or_else(|| "No update is currently available.".to_string())?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

fn start_atem_service(app: &tauri::App) -> Result<Child, Box<dyn std::error::Error>> {
    let backend = app.path().resource_dir()?.join("backend");
    let node = backend.join("runtime").join(if cfg!(windows) { "node.exe" } else { "node" });
    let server = backend.join("src").join("server.js");

    let child = Command::new(node)
        .arg(server)
        .current_dir(&backend)
        .env("SHOWDESK_NO_OPEN", "1")
        .env("SHOWDESK_PORT", "47821")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    Ok(child)
}

fn stop_atem_service(app: &AppHandle) {
    if let Some(state) = app.try_state::<AtemService>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![check_for_update, install_update])
        .setup(|app| {
            let service = start_atem_service(app)?;
            app.manage(AtemService(Mutex::new(Some(service))));

            let app_menu = SubmenuBuilder::new(app, "ShowDesk")
                .text("check_for_updates", "Check for Updates…")
                .separator()
                .quit()
                .build()?;
            let help_menu = SubmenuBuilder::new(app, "Help")
                .text("check_for_updates_help", "Check for Updates…")
                .build()?;
            let menu = MenuBuilder::new(app).items(&[&app_menu, &help_menu]).build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if event.id() == "check_for_updates" || event.id() == "check_for_updates_help" {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.eval("window.checkForShowDeskUpdate?.(true)");
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building ShowDesk");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
            stop_atem_service(app_handle);
        }
    });
}
