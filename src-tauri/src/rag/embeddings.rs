use anyhow::{Context, Result};
use rig::{
    embeddings::EmbeddingsBuilder,
    providers::ollama,
    vector_store::in_memory_store::InMemoryVectorStore,
    Embed,
};
use serde::{Deserialize, Serialize};

use super::CsvDocument;

/// The embedding model to use (hardcoded as per requirements)
pub const EMBEDDING_MODEL: &str = "nomic-embed-text";

/// Embeddable document wrapper for rig-core
#[derive(Debug, Clone, Serialize, Deserialize, Embed, Eq, PartialEq)]
pub struct EmbeddableDocument {
    /// Unique identifier
    pub id: String,
    /// The content to embed
    #[embed]
    pub content: String,
    /// Source file for attribution
    pub source_file: String,
    /// Row number for attribution
    pub row_number: usize,
}

impl From<CsvDocument> for EmbeddableDocument {
    fn from(doc: CsvDocument) -> Self {
        Self {
            id: doc.id,
            content: doc.content,
            source_file: doc.source_file,
            row_number: doc.row_number,
        }
    }
}

/// Wrapper around the vector store index for type safety
pub struct VectorIndex {
    store: InMemoryVectorStore<EmbeddableDocument>,
    embedding_model: ollama::EmbeddingModel,
}

impl VectorIndex {
    /// Create a new vector index from CSV documents
    pub async fn from_documents(documents: Vec<CsvDocument>) -> Result<Self> {
        // Initialize Ollama client (uses OLLAMA_HOST env or defaults to localhost:11434)
        let client = ollama::Client::new();
        let embedding_model = client.embedding_model(EMBEDDING_MODEL);
        
        // Convert to embeddable documents
        let embeddable_docs: Vec<EmbeddableDocument> = documents
            .into_iter()
            .map(EmbeddableDocument::from)
            .collect();
        
        if embeddable_docs.is_empty() {
            anyhow::bail!("No documents to embed");
        }
        
        // Build embeddings
        let embeddings = EmbeddingsBuilder::new(embedding_model.clone())
            .documents(embeddable_docs)
            .context("Failed to set documents for embedding")?
            .build()
            .await
            .context("Failed to build embeddings - is Ollama running with nomic-embed-text?")?;
        
        // Create vector store
        let store = InMemoryVectorStore::from_documents(embeddings);
        
        Ok(Self {
            store,
            embedding_model,
        })
    }
    
    /// Search for similar documents
    pub async fn search(&self, query: &str, top_k: usize) -> Result<Vec<EmbeddableDocument>> {
        use rig::vector_store::VectorStoreIndex;
        
        let index = self.store.clone().index(self.embedding_model.clone());
        
        let results = index
            .top_n::<EmbeddableDocument>(query, top_k)
            .await
            .context("Failed to search vector store")?;
        
        Ok(results.into_iter().map(|(_, _, doc)| doc).collect())
    }
}

/// Generate a RAG response using the selected chat model
pub async fn generate_rag_response(
    query: &str,
    context_docs: Vec<EmbeddableDocument>,
    model_name: &str,
) -> Result<(String, Vec<String>)> {
    use rig::completion::Prompt;
    
    // Build context from retrieved documents
    let context = context_docs
        .iter()
        .map(|doc| doc.content.clone())
        .collect::<Vec<_>>()
        .join("\n\n");
    
    // Extract sources for attribution
    let sources: Vec<String> = context_docs
        .iter()
        .map(|doc| format!("{}, Row {}", doc.source_file, doc.row_number))
        .collect();
    
    // Initialize Ollama client for chat
    let client = ollama::Client::new();
    
    // Build the agent with our specialized preamble
    let agent = client
        .agent(model_name)
        .preamble(CUSTOMER_DISCOVERY_PREAMBLE)
        .build();
    
    // Construct the prompt with context
    let full_prompt = format!(
        "Based on the following interview data from our customer discovery research:\n\n\
        ---BEGIN DATA---\n{}\n---END DATA---\n\n\
        Question: {}\n\n\
        Remember: Answer ONLY based on the data provided above. If the information is not in the data, say so.",
        context,
        query
    );
    
    // Generate response
    let response = agent
        .prompt(full_prompt.as_str())
        .await
        .context("Failed to generate response from LLM")?;
    
    Ok((response, sources))
}

/// The system preamble for the Customer Discovery Specialist persona
const CUSTOMER_DISCOVERY_PREAMBLE: &str = r#"You are a Customer Discovery Specialist for Inis Informatics, an expert consultant analyzing interview notes and customer research data.

Your role:
- Analyze customer interview data to extract actionable insights
- Identify patterns, pain points, and opportunities from the research
- Provide concise, evidence-based answers grounded ONLY in the provided data
- Cite specific rows/sources when making claims
- Be direct and business-focused in your responses

Important guidelines:
- NEVER make up information not present in the data
- If asked about something not in the data, clearly state that the information is not available
- Focus on patterns across multiple data points when possible
- Highlight direct quotes when relevant
- Keep responses concise and actionable

You are reviewing spreadsheet data from customer discovery interviews. Each piece of context includes the source file and row number for reference."#;
