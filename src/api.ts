import { invoke } from '@tauri-apps/api/core';
import type {
  OllamaModel,
  OllamaStatus,
  AppStatus,
  IngestResult,
  QueryResult,
} from './types';

export async function checkOllamaStatus(): Promise<OllamaStatus> {
  return invoke<OllamaStatus>('check_ollama_status');
}

export async function listAvailableModels(): Promise<OllamaModel[]> {
  return invoke<OllamaModel[]>('list_available_models');
}

export async function getStatus(): Promise<AppStatus> {
  return invoke<AppStatus>('get_status');
}

export async function ingestCsvs(folderPath: string): Promise<IngestResult> {
  return invoke<IngestResult>('ingest_csvs', { folderPath });
}

export async function askQuestion(query: string): Promise<QueryResult> {
  return invoke<QueryResult>('ask_question', { query });
}

export async function setChatModel(modelName: string): Promise<void> {
  return invoke<void>('set_chat_model', { modelName });
}
