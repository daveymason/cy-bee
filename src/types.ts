// Types for Tauri command responses

export interface OllamaModel {
  name: string;
  size: number;
  modified_at: string;
}

export interface OllamaStatus {
  is_running: boolean;
  has_embedding_model: boolean;
  chat_models_count: number;
  message: string;
}

export interface AppStatus {
  is_indexed: boolean;
  document_count: number;
  data_folder: string | null;
  selected_model: string;
}

export interface IngestResult {
  success: boolean;
  documents_ingested: number;
  files_processed: number;
  message: string;
}

export interface QueryResult {
  answer: string;
  sources: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  timestamp: Date;
}
