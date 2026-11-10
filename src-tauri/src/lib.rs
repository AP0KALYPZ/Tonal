mod commands;
mod error;
mod imaging;
mod models;
mod paper;
mod paths;
mod pdf;

use commands::JobRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(JobRegistry::default())
        .invoke_handler(tauri::generate_handler![
            commands::import_image,
            commands::import_clipboard_image,
            commands::save_project,
            commands::load_project,
            commands::path_exists,
            commands::default_export_dir,
            commands::reveal_in_folder,
            commands::source_reference,
            commands::resolve_source_path,
            commands::cancel_job,
            commands::export_png,
            commands::export_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TONAL");
}
