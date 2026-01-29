use tauri::State;
use std::sync::Arc;

use crate::state::{AppState, QueryResult};
use crate::rag::generate_rag_response;

/// Number of similar documents to retrieve for context
const TOP_K_RESULTS: usize = 5;

/// Ask a question and get a RAG-powered answer
#[tauri::command]
pub async fn ask_question(
    query: String,
    state: State<'_, Arc<AppState>>,
) -> Result<QueryResult, String> {
    // Check if we have an index
    let index_guard = state.vector_index.read().await;
    let index = index_guard
        .as_ref()
        .ok_or_else(|| "No data has been indexed yet. Please ingest CSV files first.".to_string())?;
    
    // Search for relevant documents
    let relevant_docs = index
        .search(&query, TOP_K_RESULTS)
        .await
        .map_err(|e| format!("Search failed: {}", e))?;
    
    if relevant_docs.is_empty() {
        return Ok(QueryResult {
            answer: "No relevant information found in the indexed data.".to_string(),
            sources: vec![],
        });
    }
    
    // Get the selected model
    let model_name = state.selected_model.read().await.clone();
    
    // Generate response
    let (answer, sources) = generate_rag_response(&query, relevant_docs, &model_name)
        .await
        .map_err(|e| format!("Failed to generate response: {}", e))?;
    
    Ok(QueryResult { answer, sources })
}

/// Set the chat model to use
#[tauri::command]
pub async fn set_chat_model(
    model_name: String,
    state: State<'_, Arc<AppState>>,
) -> Result<(), String> {
    let mut model = state.selected_model.write().await;
    *model = model_name;
    Ok(())
}
