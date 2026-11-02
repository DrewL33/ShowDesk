#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, OpenOptions};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};
use std::time::{Duration, Instant};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, WINDOW_SUBMENU_ID};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_window_state::{Builder as WindowStateBuilder, StateFlags};

struct AtemService(Mutex<Option<Child>>);
struct UpdaterBusy(Mutex<bool>);
struct DetachedWorkspaceState {
    path: std::path::PathBuf,
    workspaces: Mutex<Vec<String>>,
    exiting: AtomicBool,
}

impl DetachedWorkspaceState {
    fn load(path: std::path::PathBuf) -> Self {
        let workspaces = fs::read(&path).ok()
            .and_then(|contents| serde_json::from_slice::<Vec<String>>(&contents).ok())
            .unwrap_or_default()
            .into_iter()
            .filter(|workspace| workspace_title(workspace).is_some())
            .collect();
        Self { path, workspaces: Mutex::new(workspaces), exiting: AtomicBool::new(false) }
    }

    fn persist(&self, workspaces: &[String]) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let contents = serde_json::to_vec(workspaces).map_err(|error| error.to_string())?;
        fs::write(&self.path, contents).map_err(|error| error.to_string())
    }

    fn add(&self, workspace: &str) -> Result<(), String> {
        let mut workspaces = self.workspaces.lock().map_err(|_| "Workspace restore state is unavailable.".to_string())?;
        if !workspaces.iter().any(|item| item == workspace) {
            workspaces.push(workspace.to_string());
            self.persist(&workspaces)?;
        }
        Ok(())
    }

    fn remove(&self, workspace: &str) -> Result<(), String> {
        let mut workspaces = self.workspaces.lock().map_err(|_| "Workspace restore state is unavailable.".to_string())?;
        let previous_len = workspaces.len();
        workspaces.retain(|item| item != workspace);
        if workspaces.len() != previous_len { self.persist(&workspaces)?; }
        Ok(())
    }

    fn saved(&self) -> Result<Vec<String>, String> {
        self.workspaces.lock().map(|items| items.clone()).map_err(|_| "Workspace restore state is unavailable.".to_string())
    }
}

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

fn create_workspace_window(app: &AppHandle, window: &tauri::WebviewWindow, workspace: &str, connection_mode: Option<String>, connection_host: Option<String>) -> Result<(), String> {
    let title = workspace_title(&workspace).ok_or_else(|| "Unknown ShowDesk workspace.".to_string())?;
    if let Some(existing) = app.webview_windows().into_iter().find(|(label, _)| label == &format!("workspace-{workspace}")).map(|(_, window)| window) {
        existing.show().map_err(|e| format!("Unable to show the existing workspace window: {e}"))?;
        existing.set_focus().map_err(|e| format!("Unable to focus the existing workspace window: {e}"))?;
        return Ok(());
    }
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
    let workspace_script = format!("window.SHOWDESK_UNDOCKED_CONTEXT = {}; if (document.documentElement) document.documentElement.classList.add('undockedStartup');", serde_json::to_string(&context).map_err(|e| e.to_string())?);
    let restored_workspace = workspace.to_string();
    let restored_app = app.clone();
    let created = tauri::WebviewWindowBuilder::new(app, format!("workspace-{workspace}"), tauri::WebviewUrl::App("index.html".into()))
        .title(format!("ShowDesk — {title}"))
        .inner_size(initial_width, initial_height)
        .resizable(true)
        .initialization_script(&workspace_script)
        .build()
        .map_err(|e| format!("Unable to open {title} in a new window: {e}"))?;
    created.on_window_event(move |event| {
        if matches!(event, WindowEvent::CloseRequested { .. }) {
            let state = restored_app.state::<DetachedWorkspaceState>();
            if !state.exiting.load(Ordering::Relaxed) { let _ = state.remove(&restored_workspace); }
        }
    });
    app.state::<DetachedWorkspaceState>().add(workspace)?;
    Ok(())
}

#[tauri::command]
fn open_workspace_window(app: AppHandle, window: tauri::WebviewWindow, workspace: String, connection_mode: Option<String>, connection_host: Option<String>) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the main ShowDesk window can open another workspace window.".to_string()); }
    create_workspace_window(&app, &window, &workspace, connection_mode, connection_host)
}

#[tauri::command]
fn restore_workspace_windows(app: AppHandle, window: tauri::WebviewWindow, connection_mode: String, connection_host: String, hyperdeck_monitoring: bool) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the main ShowDesk window can restore workspaces.".to_string()); }
    let state = app.state::<DetachedWorkspaceState>();
    for workspace in state.saved()? {
        if workspace == "hyperdecks" && !hyperdeck_monitoring { continue; }
        create_workspace_window(&app, &window, &workspace, Some(connection_mode.clone()), Some(connection_host.clone()))?;
    }
    Ok(())
}

#[tauri::command]
fn redock_workspace(app: AppHandle, window: tauri::WebviewWindow, workspace: String) -> Result<(), String> {
    if !window.label().starts_with("workspace-") { return Err("This window does not have a detached workspace to return.".to_string()); }
    if workspace_title(&workspace).is_none() { return Err("Unknown ShowDesk workspace.".to_string()); }
    app.state::<DetachedWorkspaceState>().remove(&workspace)?;
    app.emit_to("main", "showdesk-redock-workspace", workspace).map_err(|e| e.to_string())?;
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| format!("Unable to show the main ShowDesk window: {e}"))?;
        main.set_focus().map_err(|e| format!("Unable to focus the main ShowDesk window: {e}"))?;
    }
    window.close().map_err(|e| format!("Unable to return this workspace to the main window: {e}"))
}

#[tauri::command]
fn toggle_fullscreen(window: tauri::WebviewWindow) -> Result<bool, String> {
    let next = !window.is_fullscreen().map_err(|error| error.to_string())?;
    window.set_fullscreen(next).map_err(|error| error.to_string())?;
    Ok(next)
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
    emit_native_menu_action(&app, "check-for-updates");
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

fn emit_native_menu_action(app: &AppHandle, action: &str) {
    let focused = app.webview_windows().into_values().find(|window| window.is_focused().unwrap_or(false));
    if let Some(window) = focused.or_else(|| app.get_webview_window("main")) {
        let _ = window.emit("showdesk-native-menu", action);
    }
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(WindowStateBuilder::default().with_state_flags(StateFlags::POSITION | StateFlags::SIZE | StateFlags::MAXIMIZED).build())
        .manage(AtemService(Mutex::new(None)))
        .manage(UpdaterBusy(Mutex::new(false)))
        .invoke_handler(tauri::generate_handler![ensure_atem_service, save_log_report, check_for_update, install_update, open_showdesk_repository, open_workspace_window, restore_workspace_windows, redock_workspace, toggle_fullscreen])
        .setup(|app| {
            let restore_path = app.path().app_config_dir()?.join("detached-workspaces.json");
            app.manage(DetachedWorkspaceState::load(restore_path));
            // Start eagerly, but do not prevent the UI from opening if the
            // service fails. The frontend retries through ensure_atem_service
            // and can show the precise native startup error.
            if let Err(error) = ensure_service_running(&app.handle()) {
                eprintln!("[ShowDesk ATEM service] {error}");
            }

            let about_item = MenuItemBuilder::with_id("about_showdesk", "About ShowDesk").build(app)?;
            let settings_item = MenuItemBuilder::with_id("settings_showdesk", "Settings…").build(app)?;
            let updates_item = MenuItemBuilder::with_id("check_for_updates", "Check for Updates…").build(app)?;
            let show_item = MenuItemBuilder::with_id("workspace_show", "Show View").build(app)?;
            let signal_item = MenuItemBuilder::with_id("workspace_signal", "Signal Explorer").build(app)?;
            let inspect_item = MenuItemBuilder::with_id("workspace_engineering", "Inspect").build(app)?;
            let hyperdeck_item = MenuItemBuilder::with_id("workspace_hyperdecks", "HyperDeck Monitoring").build(app)?;
            let fit_signal_item = MenuItemBuilder::with_id("signal_fit", "Fit Signal Explorer").build(app)?;
            let clear_signal_item = MenuItemBuilder::with_id("signal_clear", "Clear Signal Trace").build(app)?;
            let fullscreen_item = MenuItemBuilder::with_id("toggle_fullscreen", "Toggle Full Screen")
                .accelerator("Cmd+F")
                .build(app)?;
            let disconnect_item = MenuItemBuilder::with_id("disconnect_showdesk", "Disconnect…").build(app)?;
            let app_menu = SubmenuBuilder::new(app, "ShowDesk")
                .item(&about_item).item(&settings_item).item(&updates_item)
                .separator().item(&show_item).item(&signal_item).item(&inspect_item).item(&hyperdeck_item)
                .separator().item(&disconnect_item).separator().quit().build()?;
            // macOS automatically appends its system Full Screen command to a menu titled exactly
            // "View" (using the user's system shortcut, which may be Fn+F). The custom item above
            // owns this action so the displayed shortcut stays ⌘F.
            let view_menu = SubmenuBuilder::new(app, "View ")
                .item(&fullscreen_item).separator().item(&fit_signal_item).item(&clear_signal_item).build()?;
            let help_menu = SubmenuBuilder::new(app, "Help")
                .text("check_for_updates_help", "Check for Updates…")
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "Window")
                .id(WINDOW_SUBMENU_ID)
                .minimize()
                .maximize()
                .separator()
                .close_window()
                .build()?;
            let menu = MenuBuilder::new(app).items(&[&app_menu, &view_menu, &window_menu, &help_menu]).build()?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if event.id() == "check_for_updates" || event.id() == "check_for_updates_help" {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move { run_manual_update_check(app).await; });
                } else if event.id() == "settings_showdesk" {
                    emit_native_menu_action(app, "settings");
                } else if event.id() == "workspace_show" {
                    emit_native_menu_action(app, "show");
                } else if event.id() == "workspace_signal" {
                    emit_native_menu_action(app, "signal");
                } else if event.id() == "workspace_engineering" {
                    emit_native_menu_action(app, "engineering");
                } else if event.id() == "workspace_hyperdecks" {
                    emit_native_menu_action(app, "hyperdecks");
                } else if event.id() == "signal_fit" {
                    emit_native_menu_action(app, "signal-fit");
                } else if event.id() == "signal_clear" {
                    emit_native_menu_action(app, "signal-clear");
                } else if event.id() == "toggle_fullscreen" {
                    emit_native_menu_action(app, "fullscreen");
                } else if event.id() == "about_showdesk" {
                    show_about(app);
                } else if event.id() == "disconnect_showdesk" {
                    emit_native_menu_action(app, "disconnect");
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building ShowDesk");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { .. }, .. } = &event {
            if label == "main" {
                if let Some(state) = app_handle.try_state::<DetachedWorkspaceState>() { state.exiting.store(true, Ordering::Relaxed); }
                close_detached_workspace_windows(app_handle);
                app_handle.exit(0);
            }
        }
        if matches!(&event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
            if let Some(state) = app_handle.try_state::<DetachedWorkspaceState>() { state.exiting.store(true, Ordering::Relaxed); }
            close_detached_workspace_windows(app_handle);
            stop_atem_service(app_handle);
        }
    });
}
