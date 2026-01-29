use tauri::State;
use std::sync::Arc;

use crate::state::{AppState, IngestResult};
use crate::rag::{load_csvs_from_directory, VectorIndex};

/// Ingest all CSV files from the specified folder and build the vector index
#[tauri::command]
pub async fn ingest_csvs(
    folder_path: String,
    state: State<'_, Arc<AppState>>,
) -> Result<IngestResult, String> {
    // Load CSV documents
    let documents = load_csvs_from_directory(&folder_path)
        .map_err(|e| format!("Failed to load CSVs: {}", e))?;
    
    let doc_count = documents.len();
    
    if doc_count == 0 {
        return Ok(IngestResult {
            success: false,
            documents_ingested: 0,
            files_processed: 0,
            message: "No CSV files found or all files were empty".to_string(),
        });
    }
    
    // Count unique files
    let files: std::collections::HashSet<_> = documents
        .iter()
        .map(|d| d.source_file.clone())
        .collect();
    let file_count = files.len();
    
    // Build vector index
    let index = VectorIndex::from_documents(documents)
        .await
        .map_err(|e| format!("Failed to build vector index: {}", e))?;
    
    // Update state
    {
        let mut idx = state.vector_index.write().await;
        *idx = Some(index);
    }
    {
        let mut folder = state.data_folder.write().await;
        *folder = Some(folder_path);
    }
    {
        let mut count = state.document_count.write().await;
        *count = doc_count;
    }
    
    Ok(IngestResult {
        success: true,
        documents_ingested: doc_count,
        files_processed: file_count,
        message: format!(
            "Successfully indexed {} rows from {} CSV file(s)",
            doc_count, file_count
        ),
    })
}

/// Get the current ingestion status
#[tauri::command]
pub async fn get_status(
    state: State<'_, Arc<AppState>>,
) -> Result<crate::state::AppStatus, String> {
    let is_indexed = state.vector_index.read().await.is_some();
    let document_count = *state.document_count.read().await;
    let data_folder = state.data_folder.read().await.clone();
    let selected_model = state.selected_model.read().await.clone();
    
    Ok(crate::state::AppStatus {
        is_indexed,
        document_count,
        data_folder,
        selected_model,
    })
}
