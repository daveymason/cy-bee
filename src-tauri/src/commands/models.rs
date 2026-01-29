use crate::state::{OllamaModel, OllamaTagsResponse};

/// Known embedding-only models that should be filtered from chat selection
const EMBEDDING_MODELS: &[&str] = &[
    "nomic-embed-text",
    "all-minilm",
    "mxbai-embed-large",
    "bge-m3",
    "bge-large",
    "snowflake-arctic-embed",
    "paraphrase-multilingual",
    "granite-embedding",
    "embeddinggemma",
    "qwen3-embedding",
];

/// List available Ollama models (filtering out embedding-only models)
#[tauri::command]
pub async fn list_available_models() -> Result<Vec<OllamaModel>, String> {
    let client = reqwest::Client::new();
    
    let response = client
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama: {}. Is Ollama running?", e))?;
    
    if !response.status().is_success() {
        return Err(format!(
            "Ollama returned error status: {}",
            response.status()
        ));
    }
    
    let tags: OllamaTagsResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;
    
    // Filter out embedding models and convert to our model type
    let models: Vec<OllamaModel> = tags
        .models
        .into_iter()
        .filter(|m| {
            let name_lower = m.name.to_lowercase();
            // Filter out known embedding models
            !EMBEDDING_MODELS.iter().any(|em| name_lower.contains(em))
        })
        .map(|m| OllamaModel {
            name: m.name,
            size: m.size,
            modified_at: m.modified_at,
        })
        .collect();
    
    Ok(models)
}

/// Check if Ollama is running and the embedding model is available
#[tauri::command]
pub async fn check_ollama_status() -> Result<OllamaStatus, String> {
    let client = reqwest::Client::new();
    
    // Check if Ollama is running
    let response = client
        .get("http://localhost:11434/api/tags")
        .send()
        .await;
    
    match response {
        Ok(resp) if resp.status().is_success() => {
            let tags: OllamaTagsResponse = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse response: {}", e))?;
            
            let has_embedding_model = tags
                .models
                .iter()
                .any(|m| m.name.contains("nomic-embed-text"));
            
            let chat_models_available = tags
                .models
                .iter()
                .filter(|m| {
                    let name_lower = m.name.to_lowercase();
                    !EMBEDDING_MODELS.iter().any(|em| name_lower.contains(em))
                })
                .count();
            
            Ok(OllamaStatus {
                is_running: true,
                has_embedding_model,
                chat_models_count: chat_models_available,
                message: if has_embedding_model {
                    "Ollama is ready".to_string()
                } else {
                    "Ollama is running but nomic-embed-text is not installed. Run: ollama pull nomic-embed-text".to_string()
                },
            })
        }
        Ok(resp) => Ok(OllamaStatus {
            is_running: false,
            has_embedding_model: false,
            chat_models_count: 0,
            message: format!("Ollama returned error: {}", resp.status()),
        }),
        Err(_) => Ok(OllamaStatus {
            is_running: false,
            has_embedding_model: false,
            chat_models_count: 0,
            message: "Ollama is not running. Start it with: ollama serve".to_string(),
        }),
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OllamaStatus {
    pub is_running: bool,
    pub has_embedding_model: bool,
    pub chat_models_count: usize,
    pub message: String,
}
