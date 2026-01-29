mod commands;
mod rag;
mod state;

use std::sync::Arc;
use state::AppState;
use commands::{
    ingest_csvs, get_status,
    ask_question, set_chat_model,
    list_available_models, check_ollama_status,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(AppState::new()))
        .invoke_handler(tauri::generate_handler![
            ingest_csvs,
            get_status,
            ask_question,
            set_chat_model,
            list_available_models,
            check_ollama_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
