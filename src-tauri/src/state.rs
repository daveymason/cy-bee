use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::rag::VectorIndex;

/// Application state shared across Tauri commands
pub struct AppState {
    /// The vector index for RAG queries (None until CSVs are ingested)
    pub vector_index: RwLock<Option<VectorIndex>>,
    /// Currently selected chat model name
    pub selected_model: RwLock<String>,
    /// Path to the ingested data folder
    pub data_folder: RwLock<Option<String>>,
    /// Number of documents ingested
    pub document_count: RwLock<usize>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            vector_index: RwLock::new(None),
            selected_model: RwLock::new("llama3".to_string()),
            data_folder: RwLock::new(None),
            document_count: RwLock::new(0),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Status information returned to the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppStatus {
    pub is_indexed: bool,
    pub document_count: usize,
    pub data_folder: Option<String>,
    pub selected_model: String,
}

/// Ollama model information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
    pub modified_at: String,
}

/// Response from Ollama /api/tags endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaTagsResponse {
    pub models: Vec<OllamaModelInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaModelInfo {
    pub name: String,
    pub size: u64,
    pub modified_at: String,
    #[serde(default)]
    pub details: Option<OllamaModelDetails>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaModelDetails {
    pub family: Option<String>,
    pub parameter_size: Option<String>,
}

/// Ingestion result returned to frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestResult {
    pub success: bool,
    pub documents_ingested: usize,
    pub files_processed: usize,
    pub message: String,
}

/// RAG query result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub answer: String,
    pub sources: Vec<String>,
}
