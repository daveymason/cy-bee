import { useState, useEffect, useMemo } from 'react';
import {
  FolderOpen,
  Send,
  Database,
  CheckCircle,
  AlertCircle,
  Loader2,
  ChevronDown,
  FileSpreadsheet,
  User,
  Plus,
  Copy,
  Check,
  MessageSquare,
  Trash2,
  X,
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

interface ChatThread {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

interface Toast {
  id: string;
  message: string;
  kind: 'success' | 'info' | 'error';
  actionLabel?: string;
  onAction?: () => void;
}

interface PendingDeleteDialog {
  threadId: string;
  title: string;
}

const createNewThread = (title = 'New Chat'): ChatThread => ({
  id: crypto.randomUUID(),
  title,
  messages: [],
  createdAt: new Date(),
  updatedAt: new Date(),
});

function App() {
  // State
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>(() => [createNewThread()]);
  const [activeThreadId, setActiveThreadId] = useState<string>('');
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [leavingToastIds, setLeavingToastIds] = useState<string[]>([]);
  const [pendingDeleteDialog, setPendingDeleteDialog] = useState<PendingDeleteDialog | null>(null);
  const [isDeleteDialogClosing, setIsDeleteDialogClosing] = useState(false);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? threads[0],
    [threads, activeThreadId],
  );

  const messages = activeThread?.messages ?? [];

  // Initialize on mount
  useEffect(() => {
    initializeApp();
  }, []);

  useEffect(() => {
    if (!activeThreadId && threads.length > 0) {
      setActiveThreadId(threads[0].id);
    }
  }, [threads, activeThreadId]);

  useEffect(() => {
    if (!isInitializing) {
      const timer = window.setTimeout(() => setShowSplash(false), 220);
      return () => window.clearTimeout(timer);
    }
  }, [isInitializing]);

  const updateActiveThread = (updater: (thread: ChatThread) => ChatThread) => {
    if (!activeThread) return;

    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === activeThread.id
          ? {
              ...updater(thread),
              updatedAt: new Date(),
            }
          : thread,
      ),
    );
  };

  const showToast = (
    message: string,
    kind: Toast['kind'] = 'info',
    options?: {
      actionLabel?: string;
      onAction?: () => void;
      durationMs?: number;
    },
  ) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [
      ...prev,
      {
        id,
        message,
        kind,
        actionLabel: options?.actionLabel,
        onAction: options?.onAction,
      },
    ]);
    window.setTimeout(() => {
      dismissToast(id);
    }, options?.durationMs ?? 2600);
  };

  const dismissToast = (id: string) => {
    setLeavingToastIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      setLeavingToastIds((prev) => prev.filter((toastId) => toastId !== id));
    }, 180);
  };

  const closeDeleteDialog = () => {
    setIsDeleteDialogClosing(true);
    window.setTimeout(() => {
      setPendingDeleteDialog(null);
      setIsDeleteDialogClosing(false);
    }, 180);
  };

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
    } finally {
      setIsInitializing(false);
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
        showToast('Indexing dataset started...', 'info');

        const result = await ingestCsvs(selected);
        
        if (result.success) {
          // Update app status
          const appStat = await getStatus();
          setAppStatus(appStat);
          
          const ingestMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `✓ ${result.message}. You can now ask questions about the data.`,
            timestamp: new Date(),
          };

          updateActiveThread((thread) => ({
            ...thread,
            messages: [...thread.messages, ingestMessage],
          }));
          showToast('Dataset indexed successfully.', 'success');
        } else {
          setError(result.message);
          showToast(result.message, 'error');
        }
      }
    } catch (err) {
      setError(`Failed to ingest files: ${err}`);
      showToast('Failed to load dataset.', 'error');
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

    updateActiveThread((thread) => ({
      ...thread,
      title:
        thread.messages.length === 0 && thread.title === 'New Chat'
          ? userMessage.content.slice(0, 42)
          : thread.title,
      messages: [...thread.messages, userMessage],
    }));
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

      updateActiveThread((thread) => ({
        ...thread,
        messages: [...thread.messages, assistantMessage],
      }));
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

  const handleNewChat = () => {
    const newThread = createNewThread();
    setThreads((prev) => [newThread, ...prev]);
    setActiveThreadId(newThread.id);
    setInputValue('');
    setError(null);
    showToast('New chat created.', 'success');
  };

  const confirmDeleteChat = (threadId: string) => {
    const threadToDelete = threads.find((thread) => thread.id === threadId);
    if (!threadToDelete) return;

    const previousThreads = threads;
    const previousActiveThreadId = activeThreadId;
    let nextThreads: ChatThread[] = [];
    let nextActiveThreadId = activeThreadId;

    if (threads.length === 1) {
      const resetThread = createNewThread();
      nextThreads = [resetThread];
      nextActiveThreadId = resetThread.id;
    } else {
      nextThreads = threads.filter((thread) => thread.id !== threadId);
      if (threadId === activeThreadId) {
        nextActiveThreadId = nextThreads[0]?.id ?? '';
      }
    }

    setThreads(nextThreads);
    setActiveThreadId(nextActiveThreadId);

    showToast('Chat deleted.', 'success', {
      actionLabel: 'Undo',
      onAction: () => {
        setThreads(previousThreads);
        setActiveThreadId(previousActiveThreadId);
        showToast('Deletion undone.', 'info');
      },
      durationMs: 5000,
    });
  };

  const handleDeleteChat = (threadId: string) => {
    const threadToDelete = threads.find((thread) => thread.id === threadId);
    if (!threadToDelete) return;
    setPendingDeleteDialog({
      threadId,
      title: threadToDelete.title,
    });
    setIsDeleteDialogClosing(false);
  };

  const handleCopyMessage = async (messageId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      showToast('Response copied.', 'success');
      window.setTimeout(() => setCopiedMessageId(null), 1500);
    } catch {
      setError('Could not copy response to clipboard.');
      showToast('Could not copy response.', 'error');
    }
  };

  const showLoadingOverlay = showSplash || isIngesting;
  const loadingOverlayMessage = showSplash
    ? 'Loading your workspace...'
    : 'Indexing your dataset...';

  return (
    <div className="h-screen overflow-hidden flex flex-col">
      {/* Header */}
      <header className="glass border-b border-white/30 px-3 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between w-full gap-3">
          <div className="flex items-center gap-3">
            {/* Logo */}
            <img src="/logo.png" alt="Cy-Dog" className="w-10 h-10 rounded-xl object-cover shadow-sm" />
            <div>
              <h1 className="text-lg font-semibold text-[var(--text-primary)]">
                Cy-Dog
              </h1>
              <p className="text-xs text-[var(--text-secondary)]">
                Customer Insights & Discovery Terminal
              </p>
            </div>
          </div>

          {/* Status indicators */}
          <div className="flex items-center gap-3">
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
      <main className="flex-1 w-full overflow-hidden">
        <div className="h-full w-full grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-0">
          {/* Sidebar */}
          <aside className="glass rounded-none border-r border-white/30 p-3 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Chats</h2>
              <button
                onClick={handleNewChat}
                className="p-1.5 rounded-md bg-white/80 hover:bg-white border border-[var(--border-color)] cursor-pointer transition-colors"
                title="Start new chat"
              >
                <Plus className="w-4 h-4 text-[var(--text-secondary)]" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-2 pr-1">
              {threads
                .slice()
                .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
                .map((thread) => {
                  const isActive = activeThread?.id === thread.id;
                  return (
                    <div
                      key={thread.id}
                      onClick={() => setActiveThreadId(thread.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer relative group ${
                        isActive
                          ? 'bg-white border-[var(--color-blue)]/40 shadow-sm'
                          : 'bg-white/60 border-transparent hover:bg-white/80'
                      }`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setActiveThreadId(thread.id);
                        }
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <MessageSquare className="w-4 h-4 mt-0.5 text-[var(--text-secondary)]" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                            {thread.title}
                          </p>
                          <p className="text-xs text-[var(--text-muted)] mt-0.5">
                            {thread.messages.length} messages
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteChat(thread.id);
                        }}
                        className="absolute top-2 right-2 p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--color-red)] hover:bg-[var(--color-red)]/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                        title="Delete chat"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
            </div>
          </aside>

          {/* Chat Panel */}
          <section className="flex flex-col min-h-0 px-4 py-4">
            {/* Data Status Bar */}
            <div className="mb-4 p-4 glass rounded-2xl flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--color-blue)]/20 to-[var(--color-blue)]/5 flex items-center justify-center">
                  <Database className="w-5 h-5 text-[var(--color-blue)]" />
                </div>
                {appStatus?.is_indexed ? (
                  <div className="text-sm min-w-0">
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
                className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-[var(--color-blue)] to-[var(--color-blue-light)] hover:shadow-lg hover:shadow-[var(--color-blue)]/25 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-all duration-200 cursor-pointer"
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
            <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center py-16">
                  <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[var(--color-blue)]/10 via-[var(--color-orange)]/10 to-[var(--color-red)]/10 flex items-center justify-center mb-6">
                    <FileSpreadsheet className="w-10 h-10 text-[var(--color-blue)]" />
                  </div>
                  <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-2">
                    Customer Discovery Analysis
                  </h2>
                  <p className="text-base text-[var(--text-secondary)] max-w-xl leading-relaxed">
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
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--color-blue)] to-[var(--color-blue-light)] flex items-center justify-center flex-shrink-0 shadow-md shadow-[var(--color-blue)]/20 text-lg">
                      🐶
                    </div>
                  )}

                  <div
                    className={`max-w-[88%] rounded-2xl px-4 py-3 ${
                      message.role === 'user'
                        ? 'bg-gradient-to-r from-[var(--color-orange)] to-[var(--color-orange-light)] text-white shadow-md shadow-[var(--color-orange)]/20'
                        : 'glass relative pr-16 group'
                    }`}
                  >
                    {message.role === 'assistant' && (
                      <button
                        onClick={() => handleCopyMessage(message.id, message.content)}
                        className="absolute top-2 right-2 inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-white/80 hover:bg-white text-[var(--text-secondary)] border border-[var(--border-color)] cursor-pointer transition-all opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
                        title="Copy response"
                      >
                        {copiedMessageId === message.id ? (
                          <>
                            <Check className="w-3.5 h-3.5" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" /> Copy
                          </>
                        )}
                      </button>
                    )}

                    <p className="text-[15px] whitespace-pre-wrap leading-relaxed">{message.content}</p>

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
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--color-red)]/20 to-[var(--color-red)]/5 flex items-center justify-center flex-shrink-0">
                      <User className="w-4 h-4 text-[var(--color-red)]" />
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--color-blue)] to-[var(--color-blue-light)] flex items-center justify-center flex-shrink-0 shadow-md shadow-[var(--color-blue)]/20 text-lg">
                    🐶
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
                    ? 'Ask about the interview data...'
                    : 'Load data first...'
                }
                disabled={!appStatus?.is_indexed || isLoading}
                className="flex-1 glass rounded-xl px-4 py-3 text-[15px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-blue)]/30 disabled:opacity-50 disabled:cursor-not-allowed border-0"
              />
              <button
                type="submit"
                disabled={!inputValue.trim() || !appStatus?.is_indexed || isLoading}
                className="px-5 py-3 bg-gradient-to-r from-[var(--color-blue)] to-[var(--color-blue-light)] hover:shadow-lg hover:shadow-[var(--color-blue)]/25 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl transition-all duration-200 cursor-pointer"
              >
                <Send className="w-5 h-5" />
              </button>
            </form>
          </section>
        </div>
      </main>

      <div className="fixed left-4 bottom-4 z-[60] flex flex-col gap-2 pointer-events-none max-w-sm">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-2xl px-3 py-2 shadow-lg border bg-white/92 backdrop-blur-md min-w-[240px] text-sm transition-all ${
              leavingToastIds.includes(toast.id) ? 'toast-exit' : 'toast-enter'
            } ${
              toast.kind === 'success'
                ? 'border-[var(--success)]/30 text-[var(--text-primary)]'
                : toast.kind === 'error'
                  ? 'border-[var(--color-red)]/30 text-[var(--text-primary)]'
                  : 'border-[var(--color-blue)]/30 text-[var(--text-primary)]'
            }`}
          >
            <div className="w-7 h-7 rounded-full bg-white flex items-center justify-center border border-[var(--border-color)]">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  toast.kind === 'success'
                    ? 'bg-[var(--success)]'
                    : toast.kind === 'error'
                      ? 'bg-[var(--color-red)]'
                      : 'bg-[var(--color-blue)]'
                }`}
              />
            </div>
            <span className="flex-1">{toast.message}</span>
            <button
              onClick={() => dismissToast(toast.id)}
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            {toast.actionLabel && toast.onAction && (
              <button
                onClick={() => {
                  toast.onAction?.();
                  dismissToast(toast.id);
                }}
                className="text-xs px-2 py-1 rounded-md bg-white hover:bg-slate-50 border border-[var(--border-color)] text-[var(--text-secondary)] cursor-pointer transition-colors"
              >
                {toast.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>

      {pendingDeleteDialog && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
          <div
            className={`absolute inset-0 bg-black/20 backdrop-blur-[2px] transition-opacity duration-200 ${
              isDeleteDialogClosing ? 'opacity-0' : 'opacity-100'
            }`}
            onClick={closeDeleteDialog}
          />
          <div
            className={`relative w-full max-w-md glass rounded-2xl p-5 border-white/70 shadow-xl ${
              isDeleteDialogClosing ? 'dialog-exit' : 'dialog-enter'
            }`}
          >
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">Delete chat?</h3>
            <p className="mt-2 text-sm text-[var(--text-secondary)] leading-relaxed">
              Are you sure you want to delete <span className="font-medium text-[var(--text-primary)]">{pendingDeleteDialog.title}</span>?
            </p>

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={closeDeleteDialog}
                className="px-3 py-2 rounded-lg bg-white/80 hover:bg-white border border-[var(--border-color)] text-sm text-[var(--text-secondary)] cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  confirmDeleteChat(pendingDeleteDialog.threadId);
                  closeDeleteDialog();
                }}
                className="px-3 py-2 rounded-lg bg-gradient-to-r from-[var(--color-red)] to-[var(--color-red-light)] text-white text-sm shadow-md hover:shadow-lg cursor-pointer transition-all"
              >
                Delete Chat
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${
          showLoadingOverlay ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="absolute inset-0 bg-[linear-gradient(135deg,#f0f9ff_0%,#fef3c7_50%,#fef2f2_100%)]" />
        <div className="relative flex flex-col items-center gap-3 px-6 py-5 rounded-2xl bg-white/70 backdrop-blur-md border border-white/60 shadow-lg">
          <div className="app-spinner" />
          <p className="text-sm text-[var(--text-secondary)]">{loadingOverlayMessage}</p>
        </div>
      </div>
    </div>
  );
}

export default App;
