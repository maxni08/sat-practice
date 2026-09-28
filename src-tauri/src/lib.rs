mod storage;
mod library;

use serde_json::Value;
use std::{path::PathBuf, sync::Mutex};
use storage::{Progress, SavedState, Store};
use library::{ImportReport, Library, LibrarySnapshot};
use tauri::{Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

struct AppState {
    store: Mutex<Store>,
    library: Mutex<Library>,
    path: PathBuf,
}

#[tauri::command]
fn load_question_library(window: WebviewWindow, state: State<'_, AppState>) -> Result<LibrarySnapshot, String> {
    require_main(&window)?;
    state.library.lock().map_err(|_| "Question library is busy")?.snapshot()
}

#[tauri::command]
fn scan_question_packs(window: WebviewWindow, state: State<'_, AppState>) -> Result<bool, String> {
    require_main(&window)?;
    state.library.lock().map_err(|_| "Question library is busy")?.scan()
}

#[tauri::command]
fn import_question_file(window: WebviewWindow, state: State<'_, AppState>, path: String) -> Result<ImportReport, String> {
    require_main(&window)?;
    state.library.lock().map_err(|_| "Question library is busy")?.import_path(std::path::Path::new(&path))
}

#[tauri::command]
fn set_question_source(window: WebviewWindow, state: State<'_, AppState>, source_id: String, enabled: bool) -> Result<(), String> {
    require_main(&window)?;
    state.library.lock().map_err(|_| "Question library is busy")?.set_enabled(&source_id, enabled)
}

#[tauri::command]
fn remove_question_source(window: WebviewWindow, state: State<'_, AppState>, source_id: String) -> Result<(), String> {
    require_main(&window)?;
    state.library.lock().map_err(|_| "Question library is busy")?.remove_source(&source_id)
}

#[tauri::command]
fn save_personal_question(window: WebviewWindow, state: State<'_, AppState>, question: Value, prior_id: Option<String>) -> Result<Value, String> {
    require_main(&window)?;
    state.library.lock().map_err(|_| "Question library is busy")?.save_personal(question, prior_id.as_deref())
}

#[tauri::command]
fn deactivate_personal_question(window: WebviewWindow, state: State<'_, AppState>, question_id: String) -> Result<(), String> {
    require_main(&window)?;
    state.library.lock().map_err(|_| "Question library is busy")?.deactivate_personal(&question_id)
}

#[tauri::command]
fn save_personal_image(window: WebviewWindow, state: State<'_, AppState>, data_url: String) -> Result<String, String> {
    require_main(&window)?;
    state.library.lock().map_err(|_| "Question library is busy")?.save_personal_asset(&data_url)
}

#[tauri::command]
fn read_question_asset(window: WebviewWindow, state: State<'_, AppState>, uri: String) -> Result<String, String> {
    require_main(&window)?;
    state.library.lock().map_err(|_| "Question library is busy")?.read_asset(&uri)
}

#[tauri::command]
fn open_question_packs_folder(window: WebviewWindow, state: State<'_, AppState>) -> Result<(), String> {
    require_main(&window)?;
    let path = state.library.lock().map_err(|_| "Question library is busy")?.packs_path();
    #[cfg(target_os = "windows")]
    let mut command = std::process::Command::new("explorer.exe");
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(path).spawn().map_err(|e| format!("Could not open Question Packs folder: {e}"))?;
    Ok(())
}

// Defense in depth: custom commands can only be called from the local main webview.
// The remote Desmos window is deliberately absent from every capability.
fn require_main(window: &WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("This window cannot access local study data".into());
    }
    let url = window.url().map_err(|e| e.to_string())?;
    let allowed = matches!(url.scheme(), "tauri")
        || (matches!(url.scheme(), "http" | "https")
            && matches!(url.host_str(), Some("tauri.localhost")))
        || (cfg!(debug_assertions) && matches!(url.host_str(), Some("localhost" | "127.0.0.1")));
    if allowed {
        Ok(())
    } else {
        Err("Remote pages cannot access local study data".into())
    }
}

#[tauri::command]
fn load_state(window: WebviewWindow, state: State<'_, AppState>) -> Result<SavedState, String> {
    require_main(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "Progress database is busy")?
        .load()
}

#[tauri::command]
fn load_study(window: WebviewWindow, state: State<'_, AppState>) -> Result<Option<Value>, String> {
    require_main(&window)?;
    state.store.lock().map_err(|_| "Progress database is busy")?.load_study()
}

#[tauri::command]
fn load_playtime(window: WebviewWindow, state: State<'_, AppState>) -> Result<Option<Value>, String> {
    require_main(&window)?;
    state.store.lock().map_err(|_| "Progress database is busy")?.load_playtime()
}

#[tauri::command]
fn save_playtime(window: WebviewWindow, state: State<'_, AppState>, playtime: Value) -> Result<(), String> {
    require_main(&window)?;
    state.store.lock().map_err(|_| "Progress database is busy")?.save_playtime(&playtime)
}

#[tauri::command]
fn load_duel_history(window: WebviewWindow, state: State<'_, AppState>) -> Result<Option<Value>, String> {
    require_main(&window)?;
    state.store.lock().map_err(|_| "Progress database is busy")?.load_duel_history()
}

#[tauri::command]
fn save_duel_history(window: WebviewWindow, state: State<'_, AppState>, history: Value) -> Result<(), String> {
    require_main(&window)?;
    state.store.lock().map_err(|_| "Progress database is busy")?.save_duel_history(&history)
}

#[tauri::command]
fn commit_study(window: WebviewWindow, state: State<'_, AppState>, event_id: String, expected_revision: i64, study: Value,
    updates: std::collections::HashMap<String,Progress>, session: Option<Value>, removed: Vec<String>) -> Result<(),String> {
    require_main(&window)?;
    state.store.lock().map_err(|_| "Progress database is busy")?.commit_study(&event_id,expected_revision,&study,&updates,session.as_ref(),&removed)
}

#[tauri::command]
fn save_progress(
    window: WebviewWindow,
    state: State<'_, AppState>,
    question_id: String,
    progress: Progress,
) -> Result<(), String> {
    require_main(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "Progress database is busy")?
        .save_progress(&question_id, &progress)
}

#[tauri::command]
fn save_session(
    window: WebviewWindow,
    state: State<'_, AppState>,
    session: Option<Value>,
) -> Result<(), String> {
    require_main(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "Progress database is busy")?
        .save_session(session.as_ref())
}

#[tauri::command]
fn save_attempt(
    window: WebviewWindow,
    state: State<'_, AppState>,
    question_id: String,
    progress: Progress,
    session: Option<Value>,
) -> Result<(), String> {
    require_main(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "Progress database is busy")?
        .save_attempt(&question_id, &progress, session.as_ref())
}

#[tauri::command]
fn reset_question(
    window: WebviewWindow,
    state: State<'_, AppState>,
    question_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    state
        .store
        .lock()
        .map_err(|_| "Progress database is busy")?
        .reset_question(&question_id)
}

#[tauri::command]
fn data_location(window: WebviewWindow, state: State<'_, AppState>) -> Result<String, String> {
    require_main(&window)?;
    Ok(state.path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn open_calculator(window: WebviewWindow, app: tauri::AppHandle) -> Result<(), String> {
    require_main(&window)?;
    if let Some(calculator) = app.get_webview_window("calculator") {
        calculator.show().map_err(|e| e.to_string())?;
        calculator.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let mut calculator_size = (720.0_f64, 650.0_f64);
    if let Ok(Some(monitor)) = window.current_monitor() {
        let available = monitor
            .work_area()
            .size
            .to_logical::<f64>(monitor.scale_factor());
        calculator_size.0 = calculator_size.0.min((available.width - 24.0).max(420.0));
        calculator_size.1 = calculator_size.1.min((available.height - 64.0).max(350.0));
    }
    let calculator = WebviewWindowBuilder::new(
        &app,
        "calculator",
        WebviewUrl::External("https://www.desmos.com/calculator".parse().unwrap()),
    )
    .title("Desmos Calculator — SAT Practice")
    .inner_size(calculator_size.0, calculator_size.1)
    .min_inner_size(420.0, 350.0)
    .resizable(true)
    .center()
    .on_navigation(|url| {
        url.scheme() == "https" && matches!(url.host_str(), Some("www.desmos.com" | "desmos.com"))
    })
    .build()
    .map_err(|e| format!("Could not open Desmos: {e}"))?;
    let retained = calculator.clone();
    calculator.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = retained.hide();
        }
    });
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.show();
                let _ = main.unminimize();
                let _ = main.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Native release smoke tests may use an isolated temporary profile.
            // Normal launches always retain the platform app-data location.
            let directory = match std::env::var_os("SAT_PRACTICE_TEST_DATA_DIR") {
                Some(raw) => {
                    let candidate = std::path::PathBuf::from(raw);
                    std::fs::create_dir_all(&candidate)?;
                    let candidate = candidate.canonicalize()?;
                    if !candidate.starts_with(std::env::temp_dir().canonicalize()?) {
                        return Err(std::io::Error::other("Test data directory must be inside the system temp folder").into());
                    }
                    candidate
                }
                None => app.path().app_data_dir()?,
            };
            let path = directory.join("progress.sqlite3");
            let store = Store::open(&path).map_err(std::io::Error::other)?;
            let mut library = Library::open(&path, path.parent().ok_or("Application data path is missing")?).map_err(std::io::Error::other)?;
            library.scan().map_err(std::io::Error::other)?;
            app.manage(AppState {
                store: Mutex::new(store),
                library: Mutex::new(library),
                path,
            });
            if let Some(main) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = main.current_monitor() {
                    let available = monitor
                        .work_area()
                        .size
                        .to_logical::<f64>(monitor.scale_factor());
                    let width = 1280.0_f64.min((available.width - 24.0).max(800.0));
                    let height = 800.0_f64.min((available.height - 64.0).max(400.0));
                    main.set_size(tauri::LogicalSize::new(width, height))?;
                    main.center()?;
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_progress,
            save_session,
            save_attempt,
            reset_question,
            data_location,
            open_calculator
            ,load_study,commit_study,load_playtime,save_playtime,load_duel_history,save_duel_history,
            load_question_library,scan_question_packs,import_question_file,set_question_source,remove_question_source,
            save_personal_question,deactivate_personal_question,save_personal_image,read_question_asset,open_question_packs_folder
        ])
        .run(tauri::generate_context!())
        .expect(
            "SAT Practice could not start. Check that application data storage is writable.",
        );
}
