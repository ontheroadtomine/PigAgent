import React, { useState, useCallback } from 'react';
import { ChatMessage, ContentBlock, ExecutionStatus } from '../../../shared/types';
import MarkdownRenderer from './MarkdownRenderer';

interface Props {
  message: ChatMessage;
}

export default function MessageBubble({ message }: Props) {
  if (message.role === 'user') {
    if (!message.content) return null;
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="group relative max-w-[60%] bg-[var(--card)] border border-[var(--border)] rounded-2xl rounded-br-md px-4 py-2.5 text-sm text-[var(--foreground)]/80 shadow-sm">
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
          <div className="absolute -left-7 top-1 opacity-0 transition group-hover:opacity-100">
            <CopyButton content={message.content} title="复制消息" />
          </div>
        </div>
      </div>
    );
  }

  return <AssistantBubble message={message} />;
}

/* ── Assistant ── */

function AssistantBubble({ message }: { message: Extract<ChatMessage, { role: 'assistant' }> }) {
  const { blocks, partial, status } = message;

  if (blocks.length === 0 && partial) {
    return (
      <div className="flex items-center gap-3 py-1 animate-fade-in">
        <SpinnerDots />
        <span className="text-xs text-[var(--muted-foreground)]">
          {status === 'connecting' ? '准备请求模型...' : '思考中...'}
        </span>
      </div>
    );
  }

  const copyText = blocks.map(block => {
    if (block.type === 'text' || block.type === 'thinking') return block.content;
    if (block.type === 'tool_use') return `${block.toolName}\n${JSON.stringify(block.toolInput || {}, null, 2)}`;
    if (block.type === 'tool_result') return `${block.toolName} result\n${block.toolOutput || ''}`;
    return '';
  }).filter(Boolean).join('\n\n');
  const orderedBlocks = [
    ...blocks.filter(block => block.type !== 'text'),
    ...blocks.filter(block => block.type === 'text'),
  ];

  return (
    <div className="group/message relative w-full space-y-0.5">
      {copyText && (
        <div className="absolute -right-7 top-0 opacity-0 transition group-hover/message:opacity-100">
          <CopyButton content={copyText} title="复制整条回复" />
        </div>
      )}
      {orderedBlocks.map((block) => (
        <BlockRenderer
          key={block.id}
          block={block}
          messageStatus={status}
          hasResult={block.type === 'tool_use' && blocks.some(b => b.type === 'tool_result' && b.toolName === block.toolName)}
        />
      ))}
      {partial && blocks.length > 0 && (
        <StatusIndicator status={status} />
      )}
    </div>
  );
}

/* ── Dispatch ── */

function BlockRenderer({ block, messageStatus, hasResult }: { block: ContentBlock; messageStatus: ExecutionStatus; hasResult?: boolean }) {
  switch (block.type) {
    case 'thinking':  return <ThinkingBlock content={block.content} />;
    case 'tool_use':  return <ToolUseBlock name={block.toolName} input={block.toolInput} isRunning={messageStatus === 'executing' && !hasResult} />;
    case 'tool_result': return <ToolResultBlock name={block.toolName} output={block.toolOutput} />;
    case 'text':      return <TextBlock content={block.content} />;
    default:          return null;
  }
}

/* ── Spinner ── */

function SpinnerDots() {
  return (
    <div className="flex gap-1.5">
      <span className="w-2 h-2 bg-[var(--muted-foreground)]/30 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-2 h-2 bg-[var(--muted-foreground)]/30 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-2 h-2 bg-[var(--muted-foreground)]/30 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

function SpinnerRing({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      className="animate-spin shrink-0">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function CopyButton({ content, title = '复制' }: { content: string; title?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard denied */ }
  }, [content]);

  return (
    <button
      onClick={handleCopy}
      className="grid h-6 w-6 place-items-center rounded text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
      title={copied ? '已复制' : title}
    >
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      )}
    </button>
  );
}

/* ── Status indicator ── */

function StatusIndicator({ status }: { status: ExecutionStatus }) {
  switch (status) {
    case 'connecting':
      return (
        <div className="flex items-center gap-2 py-0.5">
          <SpinnerRing size={12} />
          <span className="text-[11px] text-[var(--muted-foreground)]">正在连接模型...</span>
        </div>
      );
    case 'thinking':
      return (
        <div className="flex items-center gap-2 py-0.5">
          <SpinnerRing size={12} />
          <span className="text-[11px] text-[var(--muted-foreground)]">思考中...</span>
        </div>
      );
    case 'executing':
      return (
        <div className="flex items-center gap-2 py-0.5">
          <SpinnerRing size={12} />
          <span className="text-[11px] text-[var(--muted-foreground)]">正在执行工具...</span>
        </div>
      );
    case 'post_tool':
      return (
        <div className="flex items-center gap-2 py-0.5">
          <SpinnerRing size={12} />
          <span className="text-[11px] text-[var(--muted-foreground)]">工具执行完成，正在整理最终回复...</span>
        </div>
      );
    case 'streaming':
      return (
        <span className="inline-block w-[7px] h-[15px] bg-[var(--foreground)]/60 cursor-blink rounded-[1px] ml-0.5 align-middle" />
      );
    case 'done':
      return null;
    default:
      return null;
  }
}

/* ── Text ── */

function TextBlock({ content }: { content: string }) {
  return (
    <div className="group w-full">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0 text-sm text-[var(--foreground)] message-content">
          <MarkdownRenderer content={content} />
        </div>
        <div className="shrink-0 opacity-0 transition group-hover:opacity-100">
          <CopyButton content={content} title="复制文本" />
        </div>
      </div>
    </div>
  );
}

/* ── Thinking ── */

function ThinkingBlock({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!content) return null;

  return (
    <div className="group mb-1">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex flex-1 items-center gap-2 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]/60 transition-colors cursor-pointer select-none text-left py-0.5"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className="transition-transform"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          ><polyline points="9 18 15 12 9 6"/></svg>
          思考
        </button>
        <div className="opacity-0 transition group-hover:opacity-100">
          <CopyButton content={content} title="复制思考" />
        </div>
      </div>
      {expanded && (
        <div className="mt-1.5 whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--muted)]/30 p-3 text-xs text-[var(--muted-foreground)] leading-relaxed">
          {content}
        </div>
      )}
    </div>
  );
}

/* ── Tool kind & summary ── */

type ToolKind = 'exploration' | 'file-edit' | 'bash' | 'tool';

function classifyTool(name: string): ToolKind {
  const n = name.toLowerCase();
  if (['search','search_codebase','read','read_file','read_files','file_read','read_files','grep','glob','web_fetch','web-fetch','fetch','skills'].includes(n)) return 'exploration';
  if (['edit','edit_file','editor','write','write_file','str_replace'].includes(n)) return 'file-edit';
  if (['bash','run_commands','execute_command','run'].includes(n)) return 'bash';
  return 'tool';
}

function ToolIcon({ kind }: { kind: ToolKind }) {
  switch (kind) {
    case 'exploration':
      return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>;
    case 'file-edit':
      return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>;
    case 'bash':
      return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>;
    default:
      return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>;
  }
}

function buildToolSummary(name: string, input?: Record<string, unknown>): string {
  const n = name.toLowerCase();
  const inp = input || {};

  if (['read_files','file_read','read_file','read'].includes(n)) {
    const files = inp.file_path || inp.filePath || inp.path;
    const list = Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : typeof files === 'string' ? [files] : [];
    if (list.length === 1) return `Read ${(list[0] as string).split(/[\\/]/).pop()}`;
    if (list.length > 1) return `Read ${list.length} files`;
    return 'Read file';
  }

  if (['search_codebase','grep','glob','search'].includes(n)) {
    const q = inp.pattern || inp.query || inp.search || inp.regex;
    if (typeof q === 'string') return `Search "${q}"`;
    return 'Search';
  }

  if (['run_commands','bash','execute_command','run'].includes(n)) {
    const cmd = inp.command || inp.commands;
    const list = Array.isArray(cmd) ? cmd : typeof cmd === 'string' ? [cmd] : [];
    if (list.length === 1) return String(list[0]);
    if (list.length > 1) return `Run ${list.length} commands`;
    return 'Run command';
  }

  if (['edit_file','edit','editor','write','write_file','str_replace'].includes(n)) {
    const path = inp.path || inp.file_path || inp.filePath;
    if (typeof path === 'string') return `Edit ${path.split(/[\\/]/).pop()}`;
    return 'Edit file';
  }

  if (['web_fetch','web-fetch','fetch_web_content','fetch'].includes(n)) {
    const url = inp.url || inp.fetch_url;
    if (typeof url === 'string') return url;
    return 'Fetch URL';
  }

  return name;
}

/* ── Tool Use ── */

function ToolUseBlock({ name, input, isRunning }: { name: string; input?: Record<string, unknown>; isRunning: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const kind = classifyTool(name);
  const summary = buildToolSummary(name, input);
  const copyText = `${name}\n${JSON.stringify(input || {}, null, 2)}`;

  return (
    <div className="group w-full py-0.5">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]/60 transition-colors cursor-pointer text-left"
        >
          <span className="shrink-0">
            {isRunning ? <SpinnerRing size={13} /> : <ToolIcon kind={kind} />}
          </span>
          <span className="truncate">{isRunning ? summary : summary}</span>
          {input && Object.keys(input).length > 0 && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              className="shrink-0 transition-transform"
              style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
            ><polyline points="9 18 15 12 9 6"/></svg>
          )}
        </button>
        <div className="opacity-0 transition group-hover:opacity-100">
          <CopyButton content={copyText} title="复制工具调用" />
        </div>
      </div>
      {expanded && input && Object.keys(input).length > 0 && (
        <div className="mt-1.5 ml-5">
          <pre className="max-h-52 overflow-auto rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-2 text-[11px] leading-relaxed text-[var(--muted-foreground)] whitespace-pre-wrap break-all font-mono">
            {JSON.stringify(input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ── Tool Result ── */

function ToolResultBlock({ name, output }: { name: string; output?: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!output) return null;

  return (
    <div className="group ml-0 py-0.5">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-2 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)]/60 transition-colors cursor-pointer"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className="transition-transform"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
          ><polyline points="9 18 15 12 9 6"/></svg>
          <span>{name} result</span>
        </button>
        <div className="opacity-0 transition group-hover:opacity-100">
          <CopyButton content={output} title="复制工具结果" />
        </div>
      </div>
      {expanded && (
        <div className="mt-1.5 ml-5 p-2.5 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 text-xs font-mono text-[var(--muted-foreground)] max-h-40 overflow-y-auto whitespace-pre-wrap leading-relaxed">
          {output.slice(0, 3000)}
          {output.length > 3000 && <span className="text-[var(--muted-foreground)]/50">...truncated</span>}
        </div>
      )}
    </div>
  );
}
