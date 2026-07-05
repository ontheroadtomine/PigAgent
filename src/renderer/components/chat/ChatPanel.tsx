import React, { useRef, useEffect, useState } from 'react';
import { useAppStore } from '../../stores/app-store';
import MessageBubble from './MessageBubble';

export default function ChatPanel() {
  const {
    messages,
    activeWorkspaceId,
    activeProvider,
    providerInfos,
    settings,
    loading,
    taskQueue,
    sendMessage,
    stopGeneration,
    regenerate,
    setProvider,
    toggleSettings,
    removeQueuedTask,
    clearTaskQueue,
    workspaces,
  } = useAppStore();
  const [input, setInput] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId);
  const llmOptions = (settings.llmApis || [])
    .filter(api => api.enabled)
    .map(api => ({
      name: `llm:${api.id}`,
      displayName: `${api.name} · ${api.model}`,
      available: true,
      version: api.baseUrl,
    }));
  const availableProviders = [
    ...providerInfos.filter(p => p.available),
    ...llmOptions,
  ];
  const currentProvider = availableProviders.find(p => p.name === activeProvider);
  const displayLabel = currentProvider?.displayName || activeProvider;

  // Get current assistant's execution status for the footer bar
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  const execStatus = lastAssistant && lastAssistant.role === 'assistant' ? lastAssistant.status : undefined;
  const isGenerating = loading || (lastAssistant?.role === 'assistant' && lastAssistant.partial);
  const statusTitle =
    execStatus === 'connecting' ? '正在连接模型'
      : execStatus === 'thinking' ? '思考中'
      : execStatus === 'executing' ? '正在执行工具'
      : execStatus === 'post_tool' ? '工具执行完成，正在整理最终回复'
      : execStatus === 'streaming' ? '正在接收回复'
      : '停止生成';

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  // Keep focus on input during generation — never block user input
  useEffect(() => {
    if (execStatus && execStatus !== 'done' && document.activeElement !== inputRef.current) {
      // Don't auto-focus, but never disable
    }
  }, [execStatus]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;
    sendMessage(text);
    setInput('');
    // Focus back to input immediately after sending
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const nativeEvent = e.nativeEvent as KeyboardEvent & { isComposing?: boolean };
    if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = () => {
    stopGeneration();
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <main className="h-full flex flex-col overflow-hidden bg-[var(--background)]">
      {/* Messages */}
      <div ref={chatRef} className="flex-1 overflow-y-auto scrollbar-thin">
        {messages.length === 0 && !isGenerating && (
          <div className="flex items-center justify-center h-full text-[var(--muted-foreground)]">
            <div className="text-center select-none">
              <div className="text-sm font-medium text-[var(--foreground)]/20 mb-2">PigAgent</div>
              <div className="text-[13px] text-[var(--muted-foreground)]/40">Ask anything — your CLI agent is ready</div>
            </div>
          </div>
        )}
        <div className="max-w-[860px] mx-auto px-5 py-8 space-y-6">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
        </div>
      </div>

      {/* Input area — never blocked */}
      <div className="bg-[var(--background)] shrink-0">
        <div className="max-w-[800px] mx-auto p-4">
          {taskQueue.length > 0 && (
            <div className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 px-3 py-2">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[11px] font-medium text-[var(--muted-foreground)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
                  <span>队列中 {taskQueue.length} 个任务</span>
                </div>
                <button
                  onClick={clearTaskQueue}
                  className="text-[11px] text-[var(--muted-foreground)] transition hover:text-[var(--destructive)]"
                  title="清空队列"
                >
                  清空
                </button>
              </div>
              <div className="space-y-1">
                {taskQueue.map((task, index) => (
                  <div key={task.id} className="flex items-center gap-2 rounded-md bg-[var(--background)]/70 px-2 py-1.5 text-xs">
                    <span className="shrink-0 text-[10px] tabular-nums text-[var(--muted-foreground)]/60">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[var(--foreground)]/70">{task.prompt}</span>
                    <button
                      onClick={() => removeQueuedTask(task.id)}
                      className="grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--destructive)]"
                      title="移除队列任务"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="relative border border-[var(--border)] rounded-xl bg-[var(--background)] shadow-sm transition-all duration-200 focus-within:border-[var(--accent)]/40 focus-within:ring-1 focus-within:ring-[var(--accent)]/20">
            <textarea
              ref={inputRef}
              rows={2}
              placeholder="Ask anything..."
              className="w-full resize-none bg-transparent pl-4 pr-16 pt-3 pb-12 focus:outline-none text-sm scrollbar-thin placeholder:text-[var(--muted-foreground)]/40 rounded-xl text-[var(--foreground)]"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
              }}
              onKeyDown={handleKeyDown}
            />

            {/* Model selector — bottom left */}
            <div className="absolute left-3 bottom-2.5 z-10">
              <button
                onClick={() => setModelOpen(!modelOpen)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] border border-[var(--border)] rounded-md text-[var(--muted-foreground)] hover:border-[var(--accent)]/30 hover:text-[var(--foreground)]/60 transition bg-[var(--background)]"
              >
                <span>{displayLabel}</span>
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {modelOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setModelOpen(false)} />
                  <div className="absolute bottom-full left-0 mb-1.5 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg py-1 min-w-[240px] z-20">
                    {availableProviders.map(p => (
                      <button
                        key={p.name}
                        onClick={() => { setProvider(p.name); setModelOpen(false); }}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--muted)] transition-colors ${p.name === activeProvider ? 'text-[var(--accent)] font-medium' : 'text-[var(--foreground)]/70'}`}
                      >{p.displayName}</button>
                    ))}
                    <div className="my-1 border-t border-[var(--border)]" />
                    <button
                      onClick={() => { setModelOpen(false); toggleSettings(); }}
                      className="w-full text-left px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]/80 transition-colors"
                    >
                      + 添加 / 配置模型
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Send / Stop / Regenerate — bottom right */}
            <div className="absolute right-3 bottom-2.5 flex items-center gap-1.5 z-10">
              {!isGenerating && messages.length > 0 && (
                <button
                  onClick={regenerate}
                  className="p-1.5 text-[var(--muted-foreground)] hover:text-[var(--foreground)]/60 transition-colors rounded-md hover:bg-[var(--muted)]"
                  title="Regenerate"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                </button>
              )}
              {isGenerating ? (
                <button
                  onClick={handleStop}
                  className="relative grid h-[26px] w-[26px] place-items-center rounded-md bg-[var(--foreground)] text-[var(--background)] transition hover:bg-[var(--destructive)]"
                  title={`${statusTitle}，点击停止`}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                    className="absolute animate-spin opacity-70">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <span className="relative h-2 w-2 rounded-[2px] bg-current" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="grid h-[26px] w-[26px] place-items-center rounded-md bg-[var(--foreground)] text-[var(--background)] transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-30"
                  title="发送"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                </button>
              )}
            </div>
          </div>

          {/* ── Footer bar ── */}
          <div className="flex items-center justify-between mt-2.5 text-[11px] text-[var(--muted-foreground)] select-none">
            <span className="truncate">{activeWorkspace?.path || ''}</span>
            <span className="shrink-0 ml-2">{displayLabel}</span>
          </div>
        </div>
      </div>
    </main>
  );
}
