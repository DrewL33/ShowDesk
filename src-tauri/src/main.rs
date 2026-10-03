#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, OpenOptions};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

struct AtemService(Mutex<Option<Child>>);

fn service_ready() -> bool {
    let address: SocketAddr = "127.0.0.1:47821".parse().expect("valid ShowDesk service address");
    TcpStream::connect_timeout(&address, Duration::from_millis(150)).is_ok()
}

fn backend_paths(app: &AppHandle) -> Result<(std::path::PathBuf, std::path::PathBuf, std::path::PathBuf), String> {
    let backend = app.path().resource_dir().map_err(|e| e.to_string())?.join("backend");
    let node = backend.join("runtime").join(if cfg!(windows) { "node.exe" } else { "node" });
    let server = backend.join("src").join("server.js");
    if !node.is_file() {
        return Err(format!("Bundled Node runtime is missing: {}", node.display()));
    }
    if !server.is_file() {
        return Err(format!("Bundled ATEM service is missing: {}", server.display()));
    }
    Ok((backend, node, server))
}

fn spawn_atem_service(app: &AppHandle) -> Result<Child, String> {
    let (backend, node, server) = backend_paths(app)?;
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let log_path = log_dir.join("atem-service.log");
    let stdout = OpenOptions::new().create(true).append(true).open(&log_path).map_err(|e| e.to_string())?;
    let stderr = stdout.try_clone().map_err(|e| e.to_string())?;

    Command::new(node)
        .arg(server)
        .current_dir(&backend)
        .env("SHOWDESK_NO_OPEN", "1")
        .env("SHOWDESK_PORT", "47821")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|e| format!("Unable to launch bundled ATEM service: {e}. Log: {}", log_path.display()))
}

fn ensure_service_running(app: &AppHandle) -> Result<(), String> {
    if service_ready() {
        return Ok(());
    }

    let state = app.state::<AtemService>();
    {
        let mut guard = state.0.lock().map_err(|_| "ATEM service state is unavailable.".to_string())?;
        let needs_start = match guard.as_mut() {
            Some(child) => match child.try_wait() {
                Ok(Some(_)) => true,
                Ok(None) => false,
                Err(_) => true,
            },
            None => true,
        };
        if needs_start {
            *guard = Some(spawn_atem_service(app)?);
        }
    }

    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if service_ready() {
            return Ok(());
        }
        {
            let mut guard = state.0.lock().map_err(|_| "ATEM service state is unavailable.".to_string())?;
            if let Some(child) = guard.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    *guard = None;
                    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
                    return Err(format!(
                        "Bundled ATEM service exited during startup ({status}). Diagnostic log: {}",
                        log_dir.join("atem-service.log").display()
                    ));
                }
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    Err("Bundled ATEM service did not become ready within 5 seconds.".to_string())
}

#[tauri::command]
async fn ensure_atem_service(app: AppHandle) -> Result<(), String> {
    ensure_service_running(&app)
}

#[tauri::command]
async fn save_log_report(app: AppHandle, filename: String, contents: String, initial_directory: Option<String>) -> Result<serde_json::Value, String> {
    let mut dialog = app.dialog().file().set_title("Save ShowDesk Log").set_file_name(filename).add_filter("ShowDesk Log", &["txt"]);
    if let Some(directory) = initial_directory { let path = std::path::PathBuf::from(directory); if path.is_dir() { dialog = dialog.set_directory(path); } }
    let Some(selected) = dialog.blocking_save_file() else { return Ok(serde_json::json!({ "saved": false })); };
    let path = selected.into_path().map_err(|_| "The selected log location is not a local file path.".to_string())?;
    fs::write(&path, contents).map_err(|e| format!("Unable to save ShowDesk log: {e}"))?;
    Ok(serde_json::json!({ "saved": true, "directory": path.parent().map(|p| p.to_string_lossy().to_string()) }))
}

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
    let version = update.version.to_string();
    let progress_app = app.clone();
    let finish_app = app.clone();
    let mut downloaded: u64 = 0;
    update.download_and_install(
        move |chunk_length, content_length| {
            downloaded = downloaded.saturating_add(chunk_length as u64);
            let _ = progress_app.emit("showdesk-update-progress", serde_json::json!({
                "phase": "downloading", "version": version, "downloaded": downloaded, "total": content_length
            }));
        },
        move || { let _ = finish_app.emit("showdesk-update-progress", serde_json::json!({ "phase": "installing" })); }
    ).await.map_err(|e| e.to_string())?;
    let _ = app.emit("showdesk-update-progress", serde_json::json!({ "phase": "restarting" }));
    app.restart();
}

async fn run_manual_update_check(app: AppHandle) {
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(error) => {
            app.dialog().message(format!("Unable to check for updates.\n\n{error}")).kind(MessageDialogKind::Error).title("ShowDesk Update").blocking_show();
            return;
        }
    };
    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.to_string();
            let install = app.dialog().message(format!("ShowDesk {version} is available.\n\nInstall the update and restart ShowDesk?")).kind(MessageDialogKind::Info).title("ShowDesk Update").buttons(MessageDialogButtons::OkCancelCustom("Install".into(), "Cancel".into())).blocking_show();
            if install {
                let version = update.version.to_string();
                let progress_app = app.clone();
                let finish_app = app.clone();
                let mut downloaded: u64 = 0;
                match update.download_and_install(
                    move |chunk_length, content_length| {
                        downloaded = downloaded.saturating_add(chunk_length as u64);
                        let _ = progress_app.emit("showdesk-update-progress", serde_json::json!({ "phase":"downloading", "version":version, "downloaded":downloaded, "total":content_length }));
                    },
                    move || { let _ = finish_app.emit("showdesk-update-progress", serde_json::json!({ "phase":"installing" })); }
                ).await {
                    Ok(()) => { let _ = app.emit("showdesk-update-progress", serde_json::json!({ "phase":"restarting" })); app.request_restart(); },
                    Err(error) => { app.dialog().message(format!("ShowDesk could not install the update. The app is still running normally.\n\n{error}")).kind(MessageDialogKind::Error).title("ShowDesk Update").blocking_show(); }
                }
            }
        }
        Ok(None) => { app.dialog().message("ShowDesk is up to date.").kind(MessageDialogKind::Info).title("ShowDesk Update").blocking_show(); }
        Err(error) => { app.dialog().message(format!("Unable to check for updates.\n\n{error}")).kind(MessageDialogKind::Error).title("ShowDesk Update").blocking_show(); }
    }
}

fn show_about(app: &AppHandle) {
    let version = app.package_info().version.to_string();
    let build_number = version.split('-').nth(1).and_then(|n| n.parse::<u32>().ok()).or_else(|| version.split('.').nth(2).and_then(|n| n.parse::<u32>().ok()));
    let build = build_number.map(|n| format!("Build{:03}", n)).unwrap_or_else(|| version.clone());
    app.dialog()
        .message(format!("ShowDesk\n{build}\nVersion {version}\nBeta\n\nRead-only ATEM monitoring and signal-path tools."))
        .kind(MessageDialogKind::Info)
        .title("About ShowDesk")
        .blocking_show();
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(AtemService(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![ensure_atem_service, save_log_report, check_for_update, install_update])
        .setup(|app| {
            // Start eagerly, but do not prevent the UI from opening if the
            // service fails. The frontend retries through ensure_atem_service
            // and can show the precise native startup error.
            if let Err(error) = ensure_service_running(&app.handle()) {
                eprintln!("[ShowDesk ATEM service] {error}");
            }

            let app_menu = SubmenuBuilder::new(app, "ShowDesk")
                .text("about_showdesk", "About ShowDesk")
                .text("check_for_updates", "Check for Updates…")
                .separator()
                .text("disconnect_showdesk", "Disconnect…")
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
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move { run_manual_update_check(app).await; });
                } else if event.id() == "about_showdesk" {
                    show_about(app);
                } else if event.id() == "disconnect_showdesk" {
                    let _ = app.emit("showdesk-native-menu", "disconnect");
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
