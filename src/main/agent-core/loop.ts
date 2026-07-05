import { LlmApiConfig } from '../../shared/types';
import { buildContextMessages } from './context-builder';
import { ToolRegistry } from './tool-registry';
import { AgentLoopOptions, AgentLoopResult, ChatMessageWire, ToolCallWire } from './types';

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MODEL_ROUND_TIMEOUT_MS = 90_000;
const MAX_LOOP_CONTEXT_CHARS = 140_000;
const KEEP_RECENT_TOOL_RESULTS = 6;

class ModelRoundTimeoutError extends Error {
  constructor() {
    super(`Model round timed out after ${Math.round(DEFAULT_MODEL_ROUND_TIMEOUT_MS / 1000)} seconds`);
    this.name = 'ModelRoundTimeoutError';
  }
}

function createRoundSignal(parentSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ModelRoundTimeoutError()), DEFAULT_MODEL_ROUND_TIMEOUT_MS);
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  const cleanup = () => {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  controller.signal.addEventListener('abort', () => {
    cleanup();
  }, { once: true });

  return { signal: controller.signal, cleanup };
}

function isModelRoundTimeout(error: unknown): boolean {
  if (error instanceof ModelRoundTimeoutError) return true;
  const anyError = error as any;
  if (anyError?.name === 'ModelRoundTimeoutError') return true;
  if (anyError?.name === 'AbortError' && anyError?.message?.includes('timed out')) return true;
  return false;
}

function buildFallbackSummary(toolCalls: AgentLoopResult['toolCalls']): string {
  const successful = toolCalls.filter(call => call.ok);
  if (!successful.length) return '模型本轮响应超时，且没有可确认完成的工具结果。请重试。';

  const describeCall = (call: AgentLoopResult['toolCalls'][number]) => {
    let pathValue = typeof call.args.path === 'string' ? call.args.path : '';
    let actionValue = '';
    try {
      const parsed = call.output ? JSON.parse(call.output) : undefined;
      const result = parsed?.result;
      if (!pathValue && typeof result?.path === 'string') pathValue = result.path;
      if (typeof result?.action === 'string') actionValue = result.action;
    } catch { /* best effort */ }
    const suffix = [actionValue, pathValue].filter(Boolean).join(' ');
    return `- ${call.name}${suffix ? `：${suffix}` : ''}`;
  };

  const lines = [
    '模型最终总结响应超时，但以下工具操作已经完成：',
    '',
    ...successful.map(describeCall),
    '',
    '你可以根据上面的工具结果继续操作，或重新发送“总结刚才的结果”。',
  ];
  return lines.join('\n');
}

function estimateMessageChars(messages: ChatMessageWire[]): number {
  return messages.reduce((total, message) => {
    const toolCalls = message.tool_calls ? JSON.stringify(message.tool_calls).length : 0;
    return total + (message.content?.length || 0) + toolCalls;
  }, 0);
}

function pruneOldToolResults(messages: ChatMessageWire[]): void {
  if (estimateMessageChars(messages) <= MAX_LOOP_CONTEXT_CHARS) return;

  const toolIndexes = messages
    .map((message, index) => ({ message, index }))
    .filter(item => item.message.role === 'tool')
    .map(item => item.index);
  const pruneIndexes = toolIndexes.slice(0, Math.max(0, toolIndexes.length - KEEP_RECENT_TOOL_RESULTS));

  for (const index of pruneIndexes) {
    const message = messages[index];
    if (!message.content || message.content.startsWith('[pruned tool result')) continue;
    message.content = `[pruned tool result to control context size; original length ${message.content.length} chars]`;
  }
}

function chatCompletionsUrl(config: LlmApiConfig): string {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  return baseUrl.endsWith('/chat/completions')
    ? baseUrl
    : baseUrl.endsWith('/v1')
      ? `${baseUrl}/chat/completions`
      : `${baseUrl}/v1/chat/completions`;
}

async function requestChatCompletion(config: LlmApiConfig, apiKey: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
  const response = await fetch(chatCompletionsUrl(config), {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: config.model, ...body }),
  });
  const text = await response.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || text || response.statusText;
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  return data;
}

async function requestChatCompletionStream(
  config: LlmApiConfig,
  apiKey: string,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onText: (delta: string) => void,
): Promise<{ content: string; toolCalls: ToolCallWire[] }> {
  const response = await fetch(chatCompletionsUrl(config), {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: config.model, ...body, stream: true }),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }
    const detail = data?.error?.message || data?.message || text || response.statusText;
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const toolCallMap = new Map<number, ToolCallWire>();
  let buffer = '';
  let content = '';

  const consumeEvent = (rawEvent: string) => {
    for (const line of rawEvent.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const rawData = line.slice(6).trim();
      if (!rawData || rawData === '[DONE]') continue;
      const data = JSON.parse(rawData);
      const delta = data?.choices?.[0]?.delta;
      if (!delta) continue;

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        content += delta.content;
        onText(delta.content);
      }

      for (const toolDelta of delta.tool_calls || []) {
        const index = Number(toolDelta.index || 0);
        const existing = toolCallMap.get(index) || {
          id: toolDelta.id || `call_${index}`,
          type: 'function',
          function: { name: '', arguments: '' },
        };
        if (toolDelta.id) existing.id = toolDelta.id;
        if (toolDelta.type) existing.type = toolDelta.type;
        if (toolDelta.function?.name) existing.function.name += toolDelta.function.name;
        if (toolDelta.function?.arguments) existing.function.arguments += toolDelta.function.arguments;
        toolCallMap.set(index, existing);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      const remaining = buffer.trim();
      if (remaining) consumeEvent(remaining);
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const event of events) consumeEvent(event);
  }

  return {
    content,
    toolCalls: Array.from(toolCallMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call)
      .filter(call => call.function.name),
  };
}

function buildSystemPrompt(): string {
  return [
    'You are PigAgent, a Codex-style desktop software agent.',
    'Operate in an agent loop: reason about the task, call tools when needed, observe results, and continue until the user request is actually complete.',
    'Use tools for current information, workspace inspection, codebase analysis, file edits, command execution, tests, builds, and patch application.',
    'For codebase documentation or architecture analysis, first use workspace_files or workspace_search, then file_read_many for the key files. Avoid reading files one by one when multiple files are needed.',
    'Prefer reading the workspace before editing. Prefer focused shell commands and tests after edits.',
    'When you use a tool, summarize the result only when useful. Do not expose secrets.',
    'For weather/current conditions, use weather_current. For public URLs, use web_fetch. For local code work, use workspace_files, workspace_search, file_read_many, workspace_list, file_read, file_write, apply_patch, and shell_exec.',
    'Finish with a concise answer in the user language. If a tool failed, explain the actionable failure.',
  ].join('\n');
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { rawArguments: raw };
  }
}

export class AgentLoop {
  constructor(private readonly tools: ToolRegistry) {}

  async run(options: AgentLoopOptions): Promise<AgentLoopResult> {
    const maxTurns = options.maxTurns || DEFAULT_MAX_TURNS;
    const messages: ChatMessageWire[] = [
      { role: 'system', content: buildSystemPrompt() },
      ...buildContextMessages(options.context),
      { role: 'user', content: options.prompt },
    ];
    const toolCallsLog: AgentLoopResult['toolCalls'] = [];

    for (let turn = 0; turn < maxTurns; turn += 1) {
      options.onEvent?.({
        type: 'status',
        status: turn === 0 ? 'thinking' : 'streaming',
        message: turn === 0 ? '分析任务' : '结合工具结果继续推理',
      });
      let startedText = false;
      let data: { content: string; toolCalls: ToolCallWire[] };
      const round = createRoundSignal(options.signal);
      try {
        data = await requestChatCompletionStream(options.config, options.apiKey, {
          messages,
          tools: this.tools.schemas(),
          tool_choice: 'auto',
          temperature: 0.2,
        }, round.signal, delta => {
          if (!startedText) {
            startedText = true;
            options.onEvent?.({ type: 'text_start' });
          }
          options.onEvent?.({ type: 'text_delta', delta });
        });
      } catch (error) {
        if (isModelRoundTimeout(error) && toolCallsLog.some(call => call.ok)) {
          const fallback = buildFallbackSummary(toolCallsLog);
          if (!startedText) options.onEvent?.({ type: 'text_start' });
          options.onEvent?.({ type: 'text_delta', delta: fallback });
          return { content: fallback, turns: turn + 1, toolCalls: toolCallsLog };
        }
        throw error;
      } finally {
        round.cleanup();
      }

      const message = { content: data.content };
      const toolCalls: ToolCallWire[] = data.toolCalls || [];

      if (toolCalls.length === 0) {
        const content = message?.content?.trim() || '';
        return { content, turns: turn + 1, toolCalls: toolCallsLog };
      }

      messages.push({
        role: 'assistant',
        content: message?.content ?? null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const args = parseArgs(call.function.arguments);
        options.onEvent?.({ type: 'tool_start', name: call.function.name, args });
        options.onEvent?.({ type: 'status', status: 'executing', message: `执行 ${call.function.name}` });
        const result = await this.tools.execute(call.function.name, args, { cwd: options.cwd });
        const output = JSON.stringify(result);
        toolCallsLog.push({ name: call.function.name, args, ok: result.ok, output });
        options.onEvent?.({
          type: 'tool_result',
          name: call.function.name,
          ok: result.ok,
          output,
        });
        options.onEvent?.({ type: 'status', status: 'post_tool', message: '工具执行完成，正在整理最终回复' });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
        pruneOldToolResults(messages);
      }
    }

    throw new Error(`Agent loop reached max turns (${maxTurns}).`);
  }
}

export { requestChatCompletion };
