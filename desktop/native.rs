// OMD-owned lifecycle around the pinned Coconut host. Guest permissions/dispatch remain upstream.
use super::*;
const SIDEBAR: f64 = 360.0;

pub fn layout(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let window = app.get_window("host").ok_or("Host missing")?;
    // Tauri's Linux multiwebview backend packs children in GtkBox and ignores
    // absolute bounds. Give GTK the same horizontal layout as the other engines.
    #[cfg(target_os = "linux")]
    {
        use gtk::prelude::*;
        let container = window.default_vbox()?;
        container.set_orientation(gtk::Orientation::Horizontal);
        for child in container.children() {
            container.set_child_packing(&child, false, true, 0, gtk::PackType::End);
            child.set_size_request(SIDEBAR as i32, -1);
        }
    }
    if let Some(host) = app.get_webview("host") { host.set_auto_resize(false)?; }
    resize(&window);
    Ok(())
}

fn resize(window: &tauri::Window) {
    let app = window.app_handle();
    if let Ok(size) = guest_size(window) {
        if let Some(host) = app.get_webview("host") {
            let _ = host.set_position(tauri::LogicalPosition::new(size.width, 0.0));
            let _ = host.set_size(tauri::LogicalSize::new(SIDEBAR, size.height));
        }
        if let Some(guest) = app.get_webview("guest") { let _ = guest.set_size(size); }
    }
}

pub fn runtime(app: &tauri::AppHandle) -> Result<(std::path::PathBuf, std::path::PathBuf), Box<dyn std::error::Error>> {
    let root = if cfg!(debug_assertions) {
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
    } else { app.path().resource_dir()? };
    let node = root.join("runtime").join(if cfg!(windows) { "node.exe" } else { "node" });
    if !node.is_file() { return Err("Bundled Node runtime is missing".into()); }
    Ok((root, node))
}

pub fn guest_size(window: &tauri::Window) -> Result<tauri::LogicalSize<f64>, String> {
    let size = window.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(window.scale_factor().map_err(|e| e.to_string())?);
    Ok(tauri::LogicalSize::new((size.width - SIDEBAR).max(1.0), size.height.max(1.0)))
}

pub fn ready(app: &tauri::AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Err(error) = do_open_guest(&handle, format!("{}/", TRUSTED_APP_ORIGIN)) {
            let _ = handle.emit_to("host", "omd-close-error", error);
        }
    });
}

pub fn disconnected(app: &tauri::AppHandle) {
    let state = app.state::<Arc<Native>>();
    // The dead sidecar has no live policy/token authority. Keep only the local
    // binding/nonce needed to flush the notebook on close; discard its replies.
    // Navigation still invalidates this identity through the upstream handler.
    state.input_dead.store(true, Ordering::SeqCst);
    let closing = lock(&state.omd_close).clone();
    lock(&state.replies).retain(|id, _| closing.as_ref() == Some(id));
    let _ = app.emit_to("host", "omd-close-error", "The local agent service stopped or could not start. Save/export your notebook and restart OMD. Check that ports 33181 and 33182 are free.");
}

fn close_error(app: &tauri::AppHandle, id: &str, message: &str) {
    let state = app.state::<Arc<Native>>();
    let mut pending = lock(&state.omd_close);
    if pending.as_deref() != Some(id) { return; }
    *pending = None;
    lock(&state.replies).remove(id);
    if let Some(guest) = app.get_webview("guest") { let _ = guest.eval("document.body.inert = false;"); }
    let _ = app.emit_to("host", "omd-close-error", message);
}

pub fn close_reply(webview: &Webview, state: &Native, id: &str, result: &Value) -> bool {
    let mut pending = lock(&state.omd_close);
    if pending.as_deref() != Some(id) { return false; }
    *pending = None;
    drop(pending);
    if result["ok"] == true && valid_context_data(&result["data"]) {
        state.omd_allow_close.store(true, Ordering::SeqCst);
        if let Some(window) = webview.app_handle().get_window("host") { let _ = window.close(); }
    } else {
        let _ = webview.eval("document.body.inert = false;");
        let _ = webview.app_handle().emit_to("host", "omd-close-error", "Your edits could not be saved. OMD is staying open; resolve the save error and try closing again.");
    }
    true
}

pub fn window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    let app = window.app_handle();
    if matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }) {
        resize(window);
    }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        let state = window.state::<Arc<Native>>();
        if state.omd_allow_close.load(Ordering::SeqCst) { return; }
        let Some(guest) = app.get_webview("guest") else { return; };
        let Some(target) = lock(&state.target).clone() else { return; };
        // No OMD bridge means no editable notebook in this guest; startup failures can still be closed.
        if target["appId"] != "omd" { return; }
        api.prevent_close();
        let mut pending = lock(&state.omd_close);
        if pending.is_some() { return; }
        let id = uuid::Uuid::new_v4().to_string();
        *pending = Some(id.clone()); drop(pending);
        lock(&state.replies).insert(id.clone(), (target, "getContext".to_string()));
        // getContext flushes editor drafts and awaits the same IndexedDB queue as the UI.
        let script = format!("document.body.inert = true; {}", bridge_script(&id, "getContext", &Value::Null, lock(&state.nonce).clone()));
        if guest.eval(&script).is_err() {
            close_error(app, &id, "OMD could not flush its notebook. The window is staying open.");
            return;
        }
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(10));
            close_error(&handle, &id, "Saving has not finished. OMD is staying open; retry after your edits are saved.");
        });
    }
}
