#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, OpenOptions};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

struct AtemService(Mutex<Option<Child>>);
struct UpdaterBusy(Mutex<bool>);
static WORKSPACE_WINDOW_ID: AtomicU64 = AtomicU64::new(1);

fn workspace_title(workspace: &str) -> Option<&'static str> {
    match workspace {
        "show" => Some("Show View"),
        "signal" => Some("Signal Explorer"),
        "engineering" => Some("Inspect"),
        "hyperdecks" => Some("HyperDeck Monitoring"),
        _ => None,
    }
}

fn close_detached_workspace_windows(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with("workspace-") {
            let _ = window.close();
        }
    }
}

#[tauri::command]
fn open_workspace_window(app: AppHandle, window: tauri::WebviewWindow, workspace: String, connection_mode: Option<String>, connection_host: Option<String>) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the main ShowDesk window can open another workspace window.".to_string()); }
    let title = workspace_title(&workspace).ok_or_else(|| "Unknown ShowDesk workspace.".to_string())?;
    let prefix = format!("workspace-{workspace}-");
    if let Some(existing) = app.webview_windows().into_iter().find(|(label, _)| label.starts_with(&prefix)).map(|(_, window)| window) {
        existing.show().map_err(|e| format!("Unable to show the existing workspace window: {e}"))?;
        existing.set_focus().map_err(|e| format!("Unable to focus the existing workspace window: {e}"))?;
        return Ok(());
    }
    let label = format!("{prefix}{}", WORKSPACE_WINDOW_ID.fetch_add(1, Ordering::Relaxed));
    // Tauri's window builder accepts logical pixels. Derive the initial size
    // from the main window's display so a detached workspace opens at a useful
    // size on both laptop panels and larger production monitors.
    let (monitor_width, monitor_height) = window.current_monitor().ok().flatten().map(|monitor| {
        let scale = monitor.scale_factor().max(1.0);
        let size = monitor.size();
        (size.width as f64 / scale, size.height as f64 / scale)
    }).unwrap_or((1440.0, 900.0));
    let minimum_width = monitor_width.min(600.0).max(440.0);
    let minimum_height = monitor_height.min(500.0).max(400.0);
    let initial_width = (monitor_width * 0.78).max(minimum_width).min(monitor_width);
    let initial_height = (monitor_height * 0.80).max(minimum_height).min(monitor_height);
    let context = serde_json::json!({ "workspace": workspace, "connectionMode": connection_mode, "connectionHost": connection_host });
    let workspace_script = format!("window.SHOWDESK_UNDOCKED_CONTEXT = {};", serde_json::to_string(&context).map_err(|e| e.to_string())?);
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::App("index.html".into()))
        .title(format!("ShowDesk — {title} · Separate Window"))
        .inner_size(initial_width, initial_height)
        .min_inner_size(minimum_width, minimum_height)
        .resizable(true)
        .initialization_script(&workspace_script)
        .build()
        .map(|_| ())
        .map_err(|e| format!("Unable to open {title} in a new window: {e}"))
}

#[tauri::command]
fn redock_workspace(app: AppHandle, window: tauri::WebviewWindow, workspace: String) -> Result<(), String> {
    if !window.label().starts_with("workspace-") { return Err("This window does not have a detached workspace to return.".to_string()); }
    if workspace_title(&workspace).is_none() { return Err("Unknown ShowDesk workspace.".to_string()); }
    app.emit_to("main", "showdesk-redock-workspace", workspace).map_err(|e| e.to_string())?;
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| format!("Unable to show the main ShowDesk window: {e}"))?;
        main.set_focus().map_err(|e| format!("Unable to focus the main ShowDesk window: {e}"))?;
    }
    window.close().map_err(|e| format!("Unable to return this workspace to the main window: {e}"))
}

fn showdesk_ports() -> (&'static str, &'static str) {
    if option_env!("SHOWDESK_CHANNEL") == Some("beta") {
        ("47831", "47832")
    } else {
        ("47821", "47822")
    }
}

fn service_ready() -> bool {
    let (service_port, _) = showdesk_ports();
    let address: SocketAddr = format!("127.0.0.1:{service_port}").parse().expect("valid ShowDesk service address");
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
    let (service_port, viewer_port) = showdesk_ports();
    let supervisor = backend.join("src").join("service-supervisor.js");
    if !supervisor.is_file() {
        return Err(format!("Bundled ATEM service supervisor is missing: {}", supervisor.display()));
    }
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let log_path = log_dir.join("atem-service.log");
    let stdout = OpenOptions::new().create(true).append(true).open(&log_path).map_err(|e| e.to_string())?;
    let stderr = stdout.try_clone().map_err(|e| e.to_string())?;

    Command::new(&node)
        .arg(supervisor)
        .arg(node)
        .arg(server)
        .current_dir(&backend)
        .env("SHOWDESK_NO_OPEN", "1")
        .env("SHOWDESK_PORT", service_port)
        .env("SHOWDESK_VIEWER_PORT", viewer_port)
        // The supervisor watches this pipe and kills the service if ShowDesk
        // crashes or is force-quit, even when the service's event loop is stuck.
        .stdin(Stdio::piped())
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
    let current_version = app.package_info().version.to_string();
    {
        let busy = app.state::<UpdaterBusy>();
        let guard = busy.0.lock().map_err(|_| "Updater state is unavailable.".to_string())?;
        if *guard { return Err("An update operation is already in progress.".to_string()); }
    }
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(match update {
        Some(update) => serde_json::json!({
            "available": true,
            "version": update.version.to_string(),
            "date": update.date.map(|date| date.to_string()),
            "body": update.body,
            "currentVersion": current_version
        }),
        None => serde_json::json!({ "available": false, "currentVersion": current_version })
    })
}

// Relaunch the installed .app through Launch Services so macOS associates the
// new process with the existing Dock application instead of the raw executable.
#[cfg(target_os = "macos")]
fn relaunch_installed_macos_app(app: &AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("Unable to locate ShowDesk executable: {e}"))?;
    let bundle = exe.ancestors().find(|p| p.extension().is_some_and(|ext| ext == "app"))
        .ok_or_else(|| format!("ShowDesk executable is not inside an app bundle: {}", exe.display()))?;
    let bundle_path = bundle.to_str().ok_or("ShowDesk app bundle path is not valid UTF-8")?;
    // Wait until the updater process exits before asking Launch Services to open
    // the exact updated bundle. Passing the path as $1 avoids shell interpolation.
    Command::new("/bin/sh")
        .args(["-c", "sleep 2; /usr/bin/open -a \"$1\"", "showdesk-relaunch", bundle_path])
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .spawn().map_err(|e| format!("Unable to schedule ShowDesk relaunch: {e}"))?;
    eprintln!("[ShowDesk updater] Relaunching installed app via Launch Services: {bundle_path}");
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    {
        let busy = app.state::<UpdaterBusy>();
        let mut guard = busy.0.lock().map_err(|_| "Updater state is unavailable.".to_string())?;
        if *guard { return Err("An update operation is already in progress.".to_string()); }
        *guard = true;
    }
    let result: Result<(), String> = async {
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
    #[cfg(target_os = "macos")]
    relaunch_installed_macos_app(&app)?;
    #[cfg(not(target_os = "macos"))]
    app.restart();
    #[allow(unreachable_code)]
    Ok(())
    }.await;
    if let Ok(mut guard) = app.state::<UpdaterBusy>().0.lock() { *guard = false; }
    result
}

async fn run_manual_update_check(app: AppHandle) {
    // Native menu checks share the same frontend updater flow. This avoids a
    // second updater controller independently checking/downloading updates.
    let _ = app.emit("showdesk-native-menu", "check-for-updates");
}

fn show_about(app: &AppHandle) {
    let version = app.package_info().version.to_string();
    let build_number = version.split('-').nth(1).and_then(|n| n.parse::<u32>().ok()).or_else(|| version.split('.').nth(2).and_then(|n| n.parse::<u32>().ok()));
    let build = build_number.map(|n| format!("Build{:03}", n)).unwrap_or_else(|| version.clone());
    let channel = if option_env!("SHOWDESK_CHANNEL") == Some("beta") { "\nBeta" } else { "" };
    app.dialog()
        .message(format!("ShowDesk\n{build}\nVersion {version}{channel}\n\nRead-only ATEM monitoring and signal-path tools."))
        .kind(MessageDialogKind::Info)
        .title("About ShowDesk")
        .blocking_show();
}

fn stop_atem_service(app: &AppHandle) {
    if let Some(state) = app.try_state::<AtemService>() {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(mut child) = guard.take() {
                // Closing stdin asks the supervisor to stop the service. The
                // supervisor handles the forced-kill fallback if it is stuck.
                drop(child.stdin.take());
                let deadline = Instant::now() + Duration::from_secs(4);
                loop {
                    match child.try_wait() {
                        Ok(Some(_)) => break,
                        Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
                        _ => {
                            eprintln!("[ShowDesk ATEM service] Shutdown supervisor is still stopping the service.");
                            break;
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
fn open_showdesk_repository() -> Result<(), String> {
    const URL: &str = "https://github.com/DrewL33/ShowDesk";
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(URL).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("cmd").args(["/C", "start", "", URL]).status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = Command::new("xdg-open").arg(URL).status();
    match status {
        Ok(result) if result.success() => Ok(()),
        Ok(result) => Err(format!("Unable to open the repository (status: {result})")),
        Err(error) => Err(format!("Unable to launch the default browser: {error}")),
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(AtemService(Mutex::new(None)))
        .manage(UpdaterBusy(Mutex::new(false)))
        .invoke_handler(tauri::generate_handler![ensure_atem_service, save_log_report, check_for_update, install_update, open_showdesk_repository, open_workspace_window, redock_workspace])
        .setup(|app| {
            // Start eagerly, but do not prevent the UI from opening if the
            // service fails. The frontend retries through ensure_atem_service
            // and can show the precise native startup error.
            if let Err(error) = ensure_service_running(&app.handle()) {
                eprintln!("[ShowDesk ATEM service] {error}");
            }

            let app_menu = SubmenuBuilder::new(app, "ShowDesk")
                .text("about_showdesk", "About ShowDesk")
                .text("settings_showdesk", "Settings…")
                .text("check_for_updates", "Check for Updates…")
                .separator()
                .text("workspace_show", "Show View")
                .text("workspace_signal", "Signal Explorer")
                .text("workspace_engineering", "Inspect")
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
                } else if event.id() == "settings_showdesk" {
                    let _ = app.emit("showdesk-native-menu", "settings");
                } else if event.id() == "workspace_show" {
                    let _ = app.emit("showdesk-native-menu", "show");
                } else if event.id() == "workspace_signal" {
                    let _ = app.emit("showdesk-native-menu", "signal");
                } else if event.id() == "workspace_engineering" {
                    let _ = app.emit("showdesk-native-menu", "engineering");
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
        if let tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { .. }, .. } = &event {
            if label == "main" {
                close_detached_workspace_windows(app_handle);
                app_handle.exit(0);
            }
        }
        if matches!(&event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
            close_detached_workspace_windows(app_handle);
            stop_atem_service(app_handle);
        }
    });
}
