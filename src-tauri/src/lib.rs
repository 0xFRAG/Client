mod transport;

use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::Mutex;
use transport::TransportState;

pub fn run() {
    let state = Arc::new(Mutex::new(TransportState::default()));

    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // On Windows/Linux, deep links arrive as CLI args to a new instance.
            // The single-instance plugin forwards them here instead.
            for arg in &argv[1..] {
                if arg.starts_with("xfrag://") {
                    let _ = app.emit("deep-link", arg.clone());
                }
            }
        }))
        .manage(state as transport::SharedState)
        .invoke_handler(tauri::generate_handler![
            transport::connect,
            transport::disconnect,
            transport::set_input,
            transport::send_chat,
        ])
        .setup(|app| {
            // Register deep link scheme at runtime (dev mode — no installer)
            #[cfg(debug_assertions)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register_all();
            }

            // Handle URLs received at startup (e.g. app launched via deep link)
            #[cfg(not(target_os = "macos"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    let handle = app.handle().clone();
                    for url in urls {
                        let _ = handle.emit("deep-link", url.to_string());
                    }
                }
            }

            // Listen for deep link URLs received while app is running (macOS)
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        let _ = handle.emit("deep-link", url.to_string());
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
