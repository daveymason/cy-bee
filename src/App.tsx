import { useState, useEffect } from 'react';
import {
  FolderOpen,
  Send,
  Database,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronDown,
  FileSpreadsheet,
  Bot,
  User,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import type { OllamaModel, OllamaStatus, AppStatus, ChatMessage } from './types';
import {
  checkOllamaStatus,
  listAvailableModels,
  getStatus,
  ingestCsvs,
  askQuestion,
  setChatModel,
} from './api';

function App() {
  // State
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize on mount
  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Check Ollama status
      const status = await checkOllamaStatus();
      setOllamaStatus(status);

      if (status.is_running) {
        // Load available models
        const availableModels = await listAvailableModels();
        setModels(availableModels);
        
        // Set default model
        if (availableModels.length > 0) {
          setSelectedModel(availableModels[0].name);
          await setChatModel(availableModels[0].name);
        }

        // Get app status
        const appStat = await getStatus();
        setAppStatus(appStat);
      }
    } catch (err) {
      setError(`Initialization failed: ${err}`);
    }
  };

  const handleModelChange = async (modelName: string) => {
    setSelectedModel(modelName);
    try {
      await setChatModel(modelName);
    } catch (err) {
      setError(`Failed to set model: ${err}`);
    }
  };

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select folder containing CSV files',
      });

      if (selected && typeof selected === 'string') {
        setIsIngesting(true);
        setError(null);

        const result = await ingestCsvs(selected);
        
        if (result.success) {
          // Update app status
          const appStat = await getStatus();
          setAppStatus(appStat);
          
          // Add system message
          setMessages(prev => [...prev, {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `✓ ${result.message}. You can now ask questions about the data.`,
            timestamp: new Date(),
          }]);
        } else {
          setError(result.message);
        }
      }
    } catch (err) {
      setError(`Failed to ingest files: ${err}`);
    } finally {
      setIsIngesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!inputValue.trim() || isLoading || !appStatus?.is_indexed) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    try {
      const result = await askQuestion(userMessage.content);
      
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.answer,
        sources: result.sources,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      setError(`Query failed: ${err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="glass border-b border-white/30 px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <img src="/logo.png" alt="Cy-Bee" className="w-10 h-10 rounded-xl" />
            <div>
              <h1 className="text-lg font-semibold text-[var(--text-primary)]">
                Cy-Bee
              </h1>
              <p className="text-xs text-[var(--text-secondary)]">
                Customer Insights & Discovery Terminal
              </p>
            </div>
          </div>

          {/* Status indicators */}
          <div className="flex items-center gap-4">
            {/* Ollama Status */}
            <div className="flex items-center gap-2 text-sm glass rounded-full px-3 py-1.5">
              {ollamaStatus?.is_running ? (
                <CheckCircle className="w-4 h-4 text-[var(--success)]" />
              ) : (
                <AlertCircle className="w-4 h-4 text-[var(--error)]" />
              )}
              <span className="text-[var(--text-secondary)]">
                {ollamaStatus?.is_running ? 'Connected' : 'Offline'}
              </span>
            </div>

            {/* Model Selector */}
            {models.length > 0 && (
              <div className="relative">
                <select
                  value={selectedModel}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="appearance-none glass rounded-lg px-3 py-1.5 pr-8 text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-blue)]/30 cursor-pointer border-0"
                >
                  {models.map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.name} ({formatFileSize(model.size)})
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)] pointer-events-none" />
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col max-w-4xl mx-auto w-full p-4">
        {/* Data Status Bar */}
        <div className="mb-4 p-4 glass rounded-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--color-blue)]/20 to-[var(--color-blue)]/5 flex items-center justify-center">
              <Database className="w-5 h-5 text-[var(--color-blue)]" />
            </div>
            {appStatus?.is_indexed ? (
              <div className="text-sm">
                <span className="text-[var(--text-primary)] font-semibold">
                  {appStatus.document_count} rows indexed
                </span>
                <span className="text-[var(--text-secondary)]"> from </span>
                <span className="text-[var(--color-blue)] font-medium">
                  {appStatus.data_folder?.split('/').pop() || 'folder'}
                </span>
              </div>
            ) : (
              <span className="text-sm text-[var(--text-secondary)]">
                No data loaded — select a folder with CSV or Excel files
              </span>
            )}
          </div>

          <button
            onClick={handleSelectFolder}
            disabled={isIngesting || !ollamaStatus?.is_running}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[var(--color-blue)] to-[var(--color-blue-light)] hover:shadow-lg hover:shadow-[var(--color-blue)]/25 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-all duration-200"
          >
            {isIngesting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Indexing...
              </>
            ) : (
              <>
                <FolderOpen className="w-4 h-4" />
                {appStatus?.is_indexed ? 'Change Folder' : 'Select Folder'}
              </>
            )}
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 bg-[var(--color-red)]/10 border border-[var(--color-red)]/20 rounded-xl flex items-center gap-2 text-sm text-[var(--color-red)]">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-auto hover:text-[var(--color-red)]/70 text-lg leading-none"
            >
              ×
            </button>
          </div>
        )}

        {/* Ollama Warning */}
        {ollamaStatus && !ollamaStatus.has_embedding_model && ollamaStatus.is_running && (
          <div className="mb-4 p-3 bg-[var(--color-orange)]/10 border border-[var(--color-orange)]/20 rounded-xl flex items-center gap-2 text-sm text-[var(--color-orange)]">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {ollamaStatus.message}
          </div>
        )}

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 mb-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[var(--color-blue)]/10 via-[var(--color-orange)]/10 to-[var(--color-red)]/10 flex items-center justify-center mb-6">
                <FileSpreadsheet className="w-10 h-10 text-[var(--color-blue)]" />
              </div>
              <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
                Customer Discovery Analysis
              </h2>
              <p className="text-sm text-[var(--text-secondary)] max-w-md leading-relaxed">
                Load your CSV or Excel interview data, then ask questions to uncover insights
                about customer pain points, patterns, and opportunities.
              </p>
            </div>
          )}

          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {message.role === 'assistant' && (
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--color-blue)] to-[var(--color-blue-light)] flex items-center justify-center flex-shrink-0 shadow-md shadow-[var(--color-blue)]/20">
                  <Bot className="w-4 h-4 text-white" />
                </div>
              )}
              
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                  message.role === 'user'
                    ? 'bg-gradient-to-r from-[var(--color-orange)] to-[var(--color-orange-light)] text-white shadow-md shadow-[var(--color-orange)]/20'
                    : 'glass'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{message.content}</p>
                
                {message.sources && message.sources.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[var(--border-color)]">
                    <p className="text-xs text-[var(--text-muted)] mb-1.5">Sources:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {message.sources.map((source, i) => (
                        <span
                          key={i}
                          className="text-xs px-2 py-1 bg-[var(--color-blue)]/10 rounded-lg text-[var(--color-blue)]"
                        >
                          {source}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {message.role === 'user' && (
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--color-red)]/20 to-[var(--color-red)]/5 flex items-center justify-center flex-shrink-0">
                  <User className="w-4 h-4 text-[var(--color-red)]" />
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[var(--color-blue)] to-[var(--color-blue-light)] flex items-center justify-center flex-shrink-0 shadow-md shadow-[var(--color-blue)]/20">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="glass rounded-2xl px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--color-blue)]" />
                  Analyzing data...
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={
              appStatus?.is_indexed
                ? "Ask about the interview data..."
                : "Load data first..."
            }
            disabled={!appStatus?.is_indexed || isLoading}
            className="flex-1 glass rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-blue)]/30 disabled:opacity-50 disabled:cursor-not-allowed border-0"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || !appStatus?.is_indexed || isLoading}
            className="px-5 py-3 bg-gradient-to-r from-[var(--color-blue)] to-[var(--color-blue-light)] hover:shadow-lg hover:shadow-[var(--color-blue)]/25 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-all duration-200"
          >
            <Send className="w-5 h-5" />
          </button>
        </form>
      </main>
    </div>
  );
}

export default App;
