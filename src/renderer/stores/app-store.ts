import { create } from 'zustand';
import { Workspace, Conversation, AgentConfig, AppSettings, ChatMessage, ContentBlock, BridgeEvent, ExecutionStatus, LlmApiChatEvent, LlmApiChatResult, LlmApiConfig, AgentMemory, AgentContextPayload, AgentContextMessage, WorkspaceMemory } from '../../shared/types';

const BRIDGE_URL = 'http://localhost:9876';
const BROWSER_SETTINGS_KEY = 'pigagent.settings';
const BROWSER_PROVIDER_KEY = 'pigagent.activeProvider';
const BROWSER_MEMORY_KEY = 'pigagent.agentMemory';
const BROWSER_WORKSPACES_KEY = 'pigagent.workspaces';
const BROWSER_CONVERSATIONS_KEY = 'pigagent.conversations';
const BROWSER_ACTIVE_WORKSPACE_KEY = 'pigagent.activeWorkspace';
const BROWSER_ACTIVE_CONVERSATION_KEY = 'pigagent.activeConversation';
const BROWSER_TRANSCRIPT_KEY = 'pigagent.transcript';
const BROWSER_WORKSPACE_MEMORY_KEY = 'pigagent.workspaceMemory';

const defaultSettings: AppSettings = {
  theme: 'light',
  autoApprove: true,
  agents: [],
  llmApis: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      apiKeyEnvVar: 'DEEPSEEK_API_KEY',
      envFilePath: '~/OpenClaw/my-openclaw-ops/.env',
      enabled: true,
    },
  ],
};

const defaultAgentMemory: AgentMemory = {
  filesTouched: [],
  artifacts: [],
  toolSummaries: [],
};

const defaultWorkspaceMemory: WorkspaceMemory = {
  filesTouched: [],
  artifacts: [],
  decisions: [],
};

function normalizeAgentMemory(memory?: Partial<AgentMemory>): AgentMemory {
  return {
    conversationSummary: memory?.conversationSummary || '',
    filesTouched: Array.isArray(memory?.filesTouched) ? memory.filesTouched.slice(-30) : [],
    artifacts: Array.isArray(memory?.artifacts) ? memory.artifacts.slice(-30) : [],
    toolSummaries: Array.isArray(memory?.toolSummaries) ? memory.toolSummaries.slice(-50) : [],
  };
}

function normalizeWorkspaceMemory(memory?: Partial<WorkspaceMemory>): WorkspaceMemory {
  return {
    projectSummary: memory?.projectSummary || '',
    filesTouched: Array.isArray(memory?.filesTouched) ? memory.filesTouched.slice(-60) : [],
    artifacts: Array.isArray(memory?.artifacts) ? memory.artifacts.slice(-60) : [],
    decisions: Array.isArray(memory?.decisions) ? memory.decisions.slice(-40) : [],
  };
}

function memoryStorageKey(conversationId?: string | null): string {
  return conversationId ? `${BROWSER_MEMORY_KEY}.${conversationId}` : BROWSER_MEMORY_KEY;
}

function workspaceMemoryStorageKey(workspaceId?: string | null): string {
  return workspaceId ? `${BROWSER_WORKSPACE_MEMORY_KEY}.${workspaceId}` : BROWSER_WORKSPACE_MEMORY_KEY;
}

function transcriptStorageKey(conversationId?: string | null): string {
  return conversationId ? `${BROWSER_TRANSCRIPT_KEY}.${conversationId}` : BROWSER_TRANSCRIPT_KEY;
}

function loadStoredMemory(conversationId?: string | null): AgentMemory {
  try {
    return normalizeAgentMemory(JSON.parse(localStorage.getItem(memoryStorageKey(conversationId)) || '{}'));
  } catch {
    return defaultAgentMemory;
  }
}

function saveStoredMemory(conversationId: string | null | undefined, memory: AgentMemory): void {
  localStorage.setItem(memoryStorageKey(conversationId), JSON.stringify(memory));
}

function loadStoredWorkspaceMemory(workspaceId?: string | null): WorkspaceMemory {
  try {
    return normalizeWorkspaceMemory(JSON.parse(localStorage.getItem(workspaceMemoryStorageKey(workspaceId)) || '{}'));
  } catch {
    return defaultWorkspaceMemory;
  }
}

function saveStoredWorkspaceMemory(workspaceId: string | null | undefined, memory: WorkspaceMemory): void {
  localStorage.setItem(workspaceMemoryStorageKey(workspaceId), JSON.stringify(memory));
}

function loadStoredTranscript(conversationId?: string | null): ChatMessage[] {
  try {
    const value = JSON.parse(localStorage.getItem(transcriptStorageKey(conversationId)) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveStoredTranscript(conversationId: string | null | undefined, messages: ChatMessage[]): void {
  if (!conversationId) return;
  localStorage.setItem(transcriptStorageKey(conversationId), JSON.stringify(messages));
}

function loadBrowserWorkspaces(): Workspace[] {
  try {
    const saved = JSON.parse(localStorage.getItem(BROWSER_WORKSPACES_KEY) || '[]') as Workspace[];
    if (Array.isArray(saved) && saved.length) return saved;
  } catch { /* ignore */ }
  const now = Date.now();
  return [{ id: 'ws1', name: 'PigAgent', path: '/Users/lapisy/PigAgent', createdAt: now, updatedAt: now }];
}

function saveBrowserWorkspaces(workspaces: Workspace[]): void {
  localStorage.setItem(BROWSER_WORKSPACES_KEY, JSON.stringify(workspaces));
}

function loadBrowserConversations(): Conversation[] {
  try {
    const saved = JSON.parse(localStorage.getItem(BROWSER_CONVERSATIONS_KEY) || '[]') as Conversation[];
    if (Array.isArray(saved) && saved.length) return saved;
  } catch { /* ignore */ }
  const now = Date.now();
  return [{ id: 'c1', workspaceId: 'ws1', title: 'PigAgent', createdAt: now, updatedAt: now, messageCount: 0 }];
}

function saveBrowserConversations(conversations: Conversation[]): void {
  localStorage.setItem(BROWSER_CONVERSATIONS_KEY, JSON.stringify(conversations));
}

function assistantBlocksToText(blocks: ContentBlock[]): string {
  return blocks
    .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
    .map(block => block.content)
    .join('\n\n')
    .trim();
}

function buildRecentContextMessages(messages: ChatMessage[], pendingPrompt?: string): AgentContextMessage[] {
  const contextMessages: AgentContextMessage[] = [];
  for (const message of messages.slice(-12)) {
    if (message.role === 'user' && message.content.trim() && message.content !== pendingPrompt) {
      contextMessages.push({ role: 'user', content: message.content.trim() });
    }
    if (message.role === 'assistant') {
      const content = assistantBlocksToText(message.blocks);
      if (content) contextMessages.push({ role: 'assistant', content });
    }
  }
  return contextMessages.slice(-10);
}

function summarizeToolResult(name: string, ok: boolean, output: string): { summary: string; path?: string; paths?: string[]; action?: AgentMemory['filesTouched'][number]['action']; artifactType?: AgentMemory['artifacts'][number]['type'] } {
  try {
    const parsed = JSON.parse(output);
    const result = parsed?.result;
    if (Array.isArray(result?.files)) {
      const paths = result.files.map((file: any) => file?.path).filter((path: unknown): path is string => typeof path === 'string');
      return {
        summary: `${ok ? '完成' : '失败'} ${name}: ${paths.slice(0, 8).join(', ')}${paths.length > 8 ? ` 等 ${paths.length} 个文件` : ''}`,
        paths,
        action: 'read',
      };
    }
    const path = typeof result?.path === 'string' ? result.path : undefined;
    const actionText = typeof result?.action === 'string' ? result.action : undefined;
    const action: AgentMemory['filesTouched'][number]['action'] =
      name === 'file_write' ? 'write'
        : name === 'apply_patch' ? 'patch'
        : name === 'file_read' || name === 'file_read_many' ? 'read'
        : 'other';
    const artifactType: AgentMemory['artifacts'][number]['type'] | undefined =
      path?.endsWith('.md') ? 'doc'
        : name === 'apply_patch' ? 'patch'
        : undefined;
    const summary = path
      ? `${ok ? '完成' : '失败'} ${name}${actionText ? ` ${actionText}` : ''}: ${path}`
      : `${ok ? '完成' : '失败'} ${name}`;
    return { summary, path, action, artifactType };
  } catch {
    return { summary: `${ok ? '完成' : '失败'} ${name}: ${output.slice(0, 200)}` };
  }
}

function normalizeLlmApiConfig(config: LlmApiConfig): LlmApiConfig {
  const legacy = config as LlmApiConfig & { envFile?: string; envVar?: string };
  return {
    ...config,
    apiKeyEnvVar: config.apiKeyEnvVar || legacy.envVar,
    envFilePath: config.envFilePath || legacy.envFile,
  };
}

function basenamePath(inputPath: string): string {
  return inputPath.split(/[\\/]/).filter(Boolean).pop() || inputPath || 'Workspace';
}

function normalizeSettings(settings: AppSettings): AppSettings {
  const savedApis = settings.llmApis?.length ? settings.llmApis : defaultSettings.llmApis;
  return {
    ...defaultSettings,
    ...settings,
    llmApis: savedApis.map(normalizeLlmApiConfig),
  };
}

interface ProviderInfo {
  name: string;
  displayName: string;
  available: boolean;
  version: string;
}

interface QueuedTask {
  id: string;
  prompt: string;
  createdAt: number;
}

interface AppState {
  initialized: boolean;
  settingsOpen: boolean;
  settings: AppSettings;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  conversations: Conversation[];
  activeConversationId: string | null;
  messages: ChatMessage[];
  providerInfos: ProviderInfo[];
  activeProvider: string;
  expandedWorkspaces: Set<string>;
  loading: boolean;
  abortController: AbortController | null;
  taskQueue: QueuedTask[];
  agentMemory: AgentMemory;
  workspaceMemory: WorkspaceMemory;

  init: () => Promise<void>;
  toggleSettings: () => void;
  saveSettings: (settings: AppSettings) => Promise<void>;

  addWorkspace: (name: string, path: string) => Promise<Workspace>;
  selectWorkspace: (id: string) => Promise<void>;
  toggleWorkspace: (id: string) => void;

  createConversation: (workspaceId: string, title: string) => Promise<Conversation>;
  renameConversation: (id: string, title: string) => Promise<void>;
  selectConversation: (conv: Conversation) => void;

  sendMessage: (prompt: string) => Promise<void>;
  runQueuedTask: (prompt: string) => Promise<void>;
  startNextQueuedTask: () => void;
  removeQueuedTask: (id: string) => void;
  clearTaskQueue: () => void;
  updateMemoryFromEvent: (event: LlmApiChatEvent) => void;
  buildAgentContext: (pendingPrompt?: string) => AgentContextPayload;
  stopGeneration: () => void;
  regenerate: () => void;
  setProvider: (provider: string) => void;

  contextFiles: string[];
  addContextFile: (path: string) => void;
  removeContextFile: (path: string) => void;
}

let msgCounter = 0;
const nextMsgId = () => `msg_${++msgCounter}`;

async function callBridge(provider: string, prompt: string, cwd: string, onEvent: (ev: BridgeEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${BRIDGE_URL}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, prompt, cwd }),
    signal,
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type) {
            if (data.type === 'error') throw new Error(data.error || 'Bridge error');
            onEvent(data as BridgeEvent);
            if (data.type === 'message_complete') return;
          }
        } catch (e) {
          if (e instanceof Error && !e.message.startsWith('Bridge error')) throw e;
        }
      }
    }
  }
  // Stream ended without message_complete — finalize anyway (safety net)
  onEvent({ type: 'message_complete' } as BridgeEvent);
}

async function callBridgeLlmApi(config: LlmApiConfig, prompt: string, cwd: string, context?: AgentContextPayload, signal?: AbortSignal): Promise<LlmApiChatResult> {
  const res = await fetch(`${BRIDGE_URL}/llm-api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, prompt, cwd, context }),
    signal,
  });
  const text = await res.text();
  let data: LlmApiChatResult;
  try {
    data = text ? JSON.parse(text) : {} as LlmApiChatResult;
  } catch {
    data = {
      ok: false,
      providerId: config.id,
      model: config.model,
      latencyMs: 0,
      error: text || `HTTP ${res.status}`,
    };
  }
  if (!res.ok && data.ok !== false) {
    return {
      ok: false,
      providerId: config.id,
      model: config.model,
      latencyMs: 0,
      error: data.error || `HTTP ${res.status}`,
    };
  }
  return data;
}

async function streamBridgeLlmApi(
  config: LlmApiConfig,
  prompt: string,
  cwd: string,
  context: AgentContextPayload,
  onEvent: (event: LlmApiChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BRIDGE_URL}/llm-api/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, prompt, cwd, context }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  const handleSseEvent = (rawEvent: string): boolean => {
    const dataLine = rawEvent.split('\n').find(line => line.startsWith('data: '));
    if (!dataLine) return false;
    const event = JSON.parse(dataLine.slice(6)) as LlmApiChatEvent;
    onEvent(event);
    completed = event.type === 'final' || event.type === 'error';
    return completed;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      const remaining = buffer.trim();
      if (remaining) handleSseEvent(remaining);
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    for (const event of events) {
      if (handleSseEvent(event)) {
        try { reader.cancel(); } catch { /* ignore */ }
        return;
      }
    }
  }

  if (!completed) {
    onEvent({ type: 'error', error: '模型响应流已结束，但没有收到最终回答。请重试。' });
  }
}

function getSelectedLlmApi(settings: AppSettings, activeProvider: string): LlmApiConfig | undefined {
  if (!activeProvider.startsWith('llm:')) return undefined;
  const id = activeProvider.slice(4);
  return settings.llmApis?.find(api => api.id === id && api.enabled);
}

function persistMessages(state: AppState, messages: ChatMessage[]): void {
  saveStoredTranscript(state.activeConversationId, messages);
}

function completeAssistant(assistantId: string, content: string, toolCalls?: LlmApiChatResult['toolCalls']) {
  return (s: AppState) => {
    const msgs = [...s.messages];
    const idx = msgs.findIndex(m => m.id === assistantId);
    if (idx < 0) return { loading: false, abortController: null };
    const toolBlocks: ContentBlock[] = (toolCalls || []).map((call, callIndex) => ({
      id: `tool_${Date.now()}_${callIndex}`,
      type: 'tool_use',
      toolName: call.name,
      toolInput: call.args,
    }));
    msgs[idx] = {
      ...msgs[idx],
      role: 'assistant',
      blocks: [
        ...toolBlocks,
        { id: `b_${Date.now()}`, type: 'text', content },
      ],
      partial: false,
      status: 'done',
    } as ChatMessage;
    persistMessages(s, msgs);
    return { messages: msgs, loading: false, abortController: null };
  };
}

function updateAssistantFromLlmEvent(assistantId: string, event: LlmApiChatEvent) {
  return (s: AppState) => {
    const msgs = [...s.messages];
    const idx = msgs.findIndex(m => m.id === assistantId);
    if (idx < 0 || msgs[idx].role !== 'assistant') return s;
    const assistant = msgs[idx] as Extract<ChatMessage, { role: 'assistant' }>;
    const blocks = [...assistant.blocks];

    if (event.type === 'status') {
      const hasStatusBlock = blocks.some(block => block.type === 'thinking' && block.id === `${assistantId}_status`);
      if (!hasStatusBlock) {
        blocks.push({ id: `${assistantId}_status`, type: 'thinking', content: event.message || '分析任务' });
      } else {
        const statusIndex = blocks.findIndex(block => block.id === `${assistantId}_status`);
        blocks[statusIndex] = { id: `${assistantId}_status`, type: 'thinking', content: event.message || '处理中' };
      }
      msgs[idx] = { ...assistant, blocks, status: event.status, partial: true };
      persistMessages(s, msgs);
      return { messages: msgs };
    }

    if (event.type === 'tool_start') {
      blocks.push({
        id: `${assistantId}_tool_${blocks.length}`,
        type: 'tool_use',
        toolName: event.name,
        toolInput: event.args,
      });
      msgs[idx] = { ...assistant, blocks, status: 'executing', partial: true };
      persistMessages(s, msgs);
      return { messages: msgs };
    }

    if (event.type === 'tool_result') {
      blocks.push({
        id: `${assistantId}_tool_result_${blocks.length}`,
        type: 'tool_result',
        toolName: event.name,
        toolOutput: event.output,
      });
      const statusIndex = blocks.findIndex(block => block.id === `${assistantId}_status`);
      if (statusIndex >= 0) {
        blocks[statusIndex] = { id: `${assistantId}_status`, type: 'thinking', content: '工具执行完成，正在整理最终回复' };
      } else {
        blocks.push({ id: `${assistantId}_status`, type: 'thinking', content: '工具执行完成，正在整理最终回复' });
      }
      msgs[idx] = { ...assistant, blocks, status: 'post_tool', partial: true };
      persistMessages(s, msgs);
      return { messages: msgs };
    }

    if (event.type === 'text_start') {
      const streamBlockId = `${assistantId}_stream`;
      if (!blocks.some(block => block.id === streamBlockId)) {
        blocks.push({ id: streamBlockId, type: 'text', content: '' });
      }
      msgs[idx] = { ...assistant, blocks, status: 'streaming', partial: true };
      persistMessages(s, msgs);
      return { messages: msgs };
    }

    if (event.type === 'text_delta') {
      const streamBlockId = `${assistantId}_stream`;
      const textIndex = blocks.findIndex(block => block.id === streamBlockId);
      if (textIndex >= 0 && blocks[textIndex].type === 'text') {
        const block = blocks[textIndex];
        blocks[textIndex] = { ...block, content: block.content + event.delta };
      } else {
        blocks.push({ id: streamBlockId, type: 'text', content: event.delta });
      }
      msgs[idx] = { ...assistant, blocks, status: 'streaming', partial: true };
      persistMessages(s, msgs);
      return { messages: msgs };
    }

    if (event.type === 'final') {
      const finalBlocks = blocks.filter(block => !(block.type === 'thinking' && block.id === `${assistantId}_status`));
      const hasStreamedText = finalBlocks.some(block => block.id === `${assistantId}_stream` && block.type === 'text' && block.content.trim());
      if (event.content && !hasStreamedText) {
        finalBlocks.push({ id: `${assistantId}_final`, type: 'text', content: event.content });
      }
      msgs[idx] = { ...assistant, blocks: finalBlocks, status: 'done', partial: false };
      persistMessages(s, msgs);
      return { messages: msgs, loading: false, abortController: null };
    }

    if (event.type === 'error') {
      blocks.push({ id: `${assistantId}_error`, type: 'text', content: `Error: ${event.error}` });
      msgs[idx] = { ...assistant, blocks, status: 'done', partial: false };
      persistMessages(s, msgs);
      return { messages: msgs, loading: false, abortController: null };
    }

    return s;
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  initialized: false,
  settingsOpen: false,
  settings: defaultSettings,
  workspaces: [],
  activeWorkspaceId: null,
  conversations: [],
  activeConversationId: null,
  messages: [],
  providerInfos: [],
  activeProvider: 'llm:deepseek',
  expandedWorkspaces: new Set<string>(),
  contextFiles: [],
  abortController: null,
  loading: false,
  taskQueue: [],
  agentMemory: defaultAgentMemory,
  workspaceMemory: defaultWorkspaceMemory,

  init: async () => {
    if (typeof window.pigagent === 'undefined') {
      let infos: ProviderInfo[] = [];
      try {
        const res = await fetch(`${BRIDGE_URL}/providers`);
        infos = await res.json();
      } catch {
        infos = [{ name: 'claude', displayName: 'Claude · Sonnet', available: true, version: '' }];
      }
      const savedSettings = (() => {
        try {
          return JSON.parse(localStorage.getItem(BROWSER_SETTINGS_KEY) || '') as AppSettings;
        } catch {
          return defaultSettings;
        }
      })();
      const settings = normalizeSettings(savedSettings);
      const savedProvider = localStorage.getItem(BROWSER_PROVIDER_KEY);
      const workspaces = loadBrowserWorkspaces();
      const allConversations = loadBrowserConversations();
      const savedWorkspaceId = localStorage.getItem(BROWSER_ACTIVE_WORKSPACE_KEY);
      const activeWorkspaceId = workspaces.find(w => w.id === savedWorkspaceId)?.id || workspaces[0]?.id || null;
      const workspaceConversations = allConversations.filter(conv => conv.workspaceId === activeWorkspaceId);
      const savedConversationId = localStorage.getItem(BROWSER_ACTIVE_CONVERSATION_KEY);
      const activeConversationId = workspaceConversations.find(conv => conv.id === savedConversationId)?.id || workspaceConversations[0]?.id || null;
      const defaultProvider = settings.llmApis.find(api => api.enabled)?.id
        ? `llm:${settings.llmApis.find(api => api.enabled)!.id}`
        : infos.filter((p: ProviderInfo) => p.available)[0]?.name || 'claude';
      set({
        initialized: true,
        workspaces,
        activeWorkspaceId,
        expandedWorkspaces: activeWorkspaceId ? new Set([activeWorkspaceId]) : new Set(),
        conversations: allConversations,
        activeConversationId,
        messages: loadStoredTranscript(activeConversationId),
        settings,
        agentMemory: loadStoredMemory(activeConversationId),
        workspaceMemory: loadStoredWorkspaceMemory(activeWorkspaceId),
        providerInfos: infos,
        activeProvider: savedProvider || defaultProvider,
      });
      return;
    }
    try {
      const [workspaces, settings, providers]: [Workspace[], AppSettings, ProviderInfo[]] = await Promise.all([
        window.pigagent.listWorkspaces(),
        window.pigagent.getSettings(),
        window.pigagent.listProviders(),
      ]);
      const savedWorkspaceId = localStorage.getItem(BROWSER_ACTIVE_WORKSPACE_KEY);
      const activeWsId = workspaces.find(ws => ws.id === savedWorkspaceId)?.id || workspaces[0]?.id || null;
      const allConvs: Conversation[] = (await Promise.all(workspaces.map(ws => window.pigagent.listConversations(ws.id)))).flat();
      const activeWorkspaceConversations = allConvs.filter(conv => conv.workspaceId === activeWsId);
      const savedConversationId = localStorage.getItem(BROWSER_ACTIVE_CONVERSATION_KEY);
      const activeConversationId = activeWorkspaceConversations.find(conv => conv.id === savedConversationId)?.id || activeWorkspaceConversations[0]?.id || null;
      set({
        initialized: true,
        workspaces,
        activeWorkspaceId: activeWsId,
        expandedWorkspaces: activeWsId ? new Set([activeWsId]) : new Set(),
        conversations: allConvs,
        activeConversationId,
        settings,
        agentMemory: loadStoredMemory(activeConversationId),
        workspaceMemory: loadStoredWorkspaceMemory(activeWsId),
        providerInfos: providers.map((p: any) => ({ ...p, displayName: p.name })),
        activeProvider: settings.llmApis?.find((api: LlmApiConfig) => api.enabled) ? `llm:${settings.llmApis.find((api: LlmApiConfig) => api.enabled)!.id}` : providers.find((p: any) => p.available)?.name || 'claude',
      });
    } catch (e) {
      console.error('Init failed:', e);
      set({ initialized: true });
    }
  },

  toggleSettings: () => set(s => ({ settingsOpen: !s.settingsOpen })),

  saveSettings: async (settings) => {
    const nextSettings = normalizeSettings(settings);
    if (typeof window.pigagent !== 'undefined') {
      await window.pigagent.saveSettings(nextSettings);
    } else {
      localStorage.setItem(BROWSER_SETTINGS_KEY, JSON.stringify(nextSettings));
    }
    set({ settings: nextSettings });
  },

  addWorkspace: async (name, dirPath) => {
    const now = Date.now();
    const workspaceName = name.trim() || basenamePath(dirPath);
    const defaultConversationTitle = workspaceName;
    if (typeof window.pigagent === 'undefined') {
      const ws: Workspace = { id: now.toString(36), name: workspaceName, path: dirPath, createdAt: now, updatedAt: now };
      const conv: Conversation = { id: `${ws.id}_c1`, workspaceId: ws.id, title: defaultConversationTitle, createdAt: now, updatedAt: now, messageCount: 0 };
      set(s => {
        const workspaces = [ws, ...s.workspaces];
        const allConversations = [...loadBrowserConversations(), conv];
        saveBrowserWorkspaces(workspaces);
        saveBrowserConversations(allConversations);
        localStorage.setItem(BROWSER_ACTIVE_WORKSPACE_KEY, ws.id);
        localStorage.setItem(BROWSER_ACTIVE_CONVERSATION_KEY, conv.id);
        return {
          workspaces,
          conversations: allConversations,
          activeWorkspaceId: ws.id,
          activeConversationId: conv.id,
          messages: [],
          agentMemory: defaultAgentMemory,
          workspaceMemory: defaultWorkspaceMemory,
          expandedWorkspaces: new Set([...s.expandedWorkspaces, ws.id]),
        };
      });
      return ws;
    }
    const ws = await window.pigagent.addWorkspace(workspaceName, dirPath);
    const conv = await window.pigagent.createConversation(ws.id, ws.name || defaultConversationTitle);
    set(s => ({
      workspaces: [ws, ...s.workspaces],
      conversations: [conv, ...s.conversations],
      activeWorkspaceId: ws.id,
      activeConversationId: conv.id,
      messages: [],
      agentMemory: defaultAgentMemory,
      workspaceMemory: defaultWorkspaceMemory,
      expandedWorkspaces: new Set([...s.expandedWorkspaces, ws.id]),
    }));
    return ws;
  },

  selectWorkspace: async (id) => {
    const state = get();
    const workspace = state.workspaces.find(ws => ws.id === id);
    if (!workspace) return;
    saveStoredTranscript(state.activeConversationId, state.messages);
    localStorage.setItem(BROWSER_ACTIVE_WORKSPACE_KEY, id);

    if (typeof window.pigagent === 'undefined') {
      const allConversations = loadBrowserConversations();
      const workspaceConversations = allConversations.filter(conv => conv.workspaceId === id);
      let conversations = workspaceConversations;
      if (!conversations.length) {
        const now = Date.now();
        const conv: Conversation = { id: `${id}_${now.toString(36)}`, workspaceId: id, title: workspace.name || 'New conversation', createdAt: now, updatedAt: now, messageCount: 0 };
        const nextAllConversations = [...allConversations, conv];
        saveBrowserConversations(nextAllConversations);
        conversations = [conv];
      }
      const activeConversationId = conversations[0]?.id || null;
      if (activeConversationId) localStorage.setItem(BROWSER_ACTIVE_CONVERSATION_KEY, activeConversationId);
      set({
        activeWorkspaceId: id,
        conversations: conversations.length === allConversations.length ? allConversations : loadBrowserConversations(),
        activeConversationId,
        messages: loadStoredTranscript(activeConversationId),
        agentMemory: loadStoredMemory(activeConversationId),
        workspaceMemory: loadStoredWorkspaceMemory(id),
        expandedWorkspaces: new Set([...state.expandedWorkspaces, id]),
      });
      return;
    }

    const conversations = await window.pigagent.listConversations(id);
    const activeConversationId = conversations[0]?.id || null;
    const mergedConversations = [
      ...state.conversations.filter(conv => conv.workspaceId !== id),
      ...conversations,
    ];
    set({
      activeWorkspaceId: id,
      conversations: mergedConversations,
      activeConversationId,
      messages: loadStoredTranscript(activeConversationId),
      agentMemory: loadStoredMemory(activeConversationId),
      workspaceMemory: loadStoredWorkspaceMemory(id),
      expandedWorkspaces: new Set([...state.expandedWorkspaces, id]),
    });
  },

  toggleWorkspace: (id) => set(s => {
    const next = new Set(s.expandedWorkspaces);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { expandedWorkspaces: next };
  }),

  createConversation: async (workspaceId, title) => {
    const previous = get();
    saveStoredTranscript(previous.activeConversationId, previous.messages);
    const workspace = previous.workspaces.find(ws => ws.id === workspaceId);
    const conversationTitle = title.trim() || workspace?.name || 'New conversation';
    if (typeof window.pigagent === 'undefined') {
      const conv: Conversation = { id: Date.now().toString(36), workspaceId, title: conversationTitle, createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 };
      const allConversations = [...loadBrowserConversations(), conv];
      saveBrowserConversations(allConversations);
      localStorage.setItem(BROWSER_ACTIVE_WORKSPACE_KEY, workspaceId);
      localStorage.setItem(BROWSER_ACTIVE_CONVERSATION_KEY, conv.id);
      set(s => ({
        conversations: [conv, ...s.conversations],
        activeWorkspaceId: workspaceId,
        activeConversationId: conv.id,
        messages: [],
        agentMemory: defaultAgentMemory,
        workspaceMemory: loadStoredWorkspaceMemory(workspaceId),
        expandedWorkspaces: new Set([...s.expandedWorkspaces, workspaceId]),
      }));
      return conv;
    }
    const conv = await window.pigagent.createConversation(workspaceId, conversationTitle);
    set(s => ({
      conversations: [conv, ...s.conversations.filter(existing => existing.id !== conv.id)],
      activeWorkspaceId: workspaceId,
      activeConversationId: conv.id,
      messages: [],
      agentMemory: defaultAgentMemory,
      workspaceMemory: loadStoredWorkspaceMemory(workspaceId),
      expandedWorkspaces: new Set([...s.expandedWorkspaces, workspaceId]),
    }));
    return conv;
  },

  renameConversation: async (id, title) => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    if (typeof window.pigagent !== 'undefined') {
      await window.pigagent.renameConversation(id, nextTitle);
    } else {
      const allConversations = loadBrowserConversations().map(conversation =>
        conversation.id === id
          ? { ...conversation, title: nextTitle, updatedAt: Date.now() }
          : conversation,
      );
      saveBrowserConversations(allConversations);
    }
    set(s => ({
      conversations: s.conversations.map(conversation =>
        conversation.id === id
          ? { ...conversation, title: nextTitle, updatedAt: Date.now() }
          : conversation,
      ),
    }));
  },

  selectConversation: (conv) => {
    const state = get();
    saveStoredTranscript(state.activeConversationId, state.messages);
    localStorage.setItem(BROWSER_ACTIVE_CONVERSATION_KEY, conv.id);
    set({ activeConversationId: conv.id, messages: loadStoredTranscript(conv.id), agentMemory: loadStoredMemory(conv.id) });
  },

  sendMessage: async (prompt) => {
    const state = get();
    if (state.loading) {
      const text = prompt.trim();
      if (!text) return;
      set(s => ({
        taskQueue: [
          ...s.taskQueue,
          { id: `queue_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, prompt: text, createdAt: Date.now() },
        ],
      }));
      return;
    }
    await get().runQueuedTask(prompt);
  },

  runQueuedTask: async (prompt) => {
    const state = get();
    const userMsg: ChatMessage = { id: nextMsgId(), role: 'user', content: prompt, timestamp: Date.now() };
    const assistantMsg: ChatMessage = { id: nextMsgId(), role: 'assistant', blocks: [], partial: true, status: 'connecting', timestamp: Date.now() };
    const controller = new AbortController();

    set(s => {
      const messages = [...s.messages, userMsg, assistantMsg];
      persistMessages(s, messages);
      return { messages, loading: true, abortController: controller };
    });

    const selectedLlmApi = getSelectedLlmApi(state.settings, state.activeProvider);
    if (selectedLlmApi) {
      const assistantId = assistantMsg.id;
      const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId);
      const cwd = ws?.path || '/tmp';
      const context = get().buildAgentContext(prompt);
      set(updateAssistantFromLlmEvent(assistantId, { type: 'status', status: 'thinking', message: '分析任务' }));
      try {
        if (typeof window.pigagent !== 'undefined') {
          await window.pigagent.streamLlmApi(selectedLlmApi, prompt, cwd, context, (event: LlmApiChatEvent) => {
            get().updateMemoryFromEvent(event);
            set(updateAssistantFromLlmEvent(assistantId, event));
          });
        } else {
          await streamBridgeLlmApi(selectedLlmApi, prompt, cwd, context, event => {
            get().updateMemoryFromEvent(event);
            set(updateAssistantFromLlmEvent(assistantId, event));
          }, controller.signal);
        }
      } catch (e: any) {
        set(completeAssistant(assistantId, `Error: ${e?.message || e}`));
      }
      get().startNextQueuedTask();
      return;
    }

    if (typeof window.pigagent === 'undefined') {
      const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId);
      const cwd = ws?.path || process.cwd?.() || '/tmp';
      const assistantId = assistantMsg.id;

      const onEvent = (ev: BridgeEvent) => {
        set(s => {
          const msgs = [...s.messages];
          const idx = msgs.findIndex(m => m.id === assistantId);
          if (idx < 0) return s;
          const assistant = { ...msgs[idx] } as Extract<ChatMessage, { role: 'assistant' }>;
          const blocks = [...assistant.blocks];

          switch (ev.type) {
            case 'block_start': {
              const newBlock: ContentBlock = ev.blockType === 'text' || ev.blockType === 'thinking'
                ? { id: ev.blockId, type: ev.blockType, content: '' }
                : ev.blockType === 'tool_use'
                  ? { id: ev.blockId, type: 'tool_use', toolName: ev.toolName || '', toolInput: {} }
                  : { id: ev.blockId, type: 'tool_result', toolName: ev.toolName || '', toolOutput: '' };
              blocks.push(newBlock);
              // Track status: tool_use → executing
              const nextStatus: ExecutionStatus = ev.blockType === 'tool_use' ? 'executing'
                : ev.blockType === 'text' ? 'streaming'
                : ev.blockType === 'thinking' ? 'thinking'
                : (assistant as Extract<ChatMessage, { role: 'assistant' }>).status;
              msgs[idx] = { ...assistant, blocks, status: nextStatus } as ChatMessage;
              return { messages: msgs };
            }
            case 'block_delta': {
              const bi = blocks.findIndex(b => b.id === ev.blockId);
              if (bi >= 0) {
                const b = blocks[bi];
                if (b.type === 'text') {
                  blocks[bi] = { ...b, content: b.content + ev.delta };
                } else if (b.type === 'tool_use') {
                  try {
                    const partial = JSON.parse(ev.delta);
                    blocks[bi] = { ...b, toolInput: { ...b.toolInput, ...partial } };
                  } catch { /* partial JSON */ }
                }
              }
              break;
            }
            case 'block_full': {
              const fullBlock: ContentBlock = ev.blockType === 'thinking'
                ? { id: ev.blockId, type: 'thinking', content: ev.content || '' }
                : ev.blockType === 'tool_result'
                  ? { id: ev.blockId, type: 'tool_result', toolName: ev.toolName || '', toolOutput: ev.toolOutput || '' }
                  : ev.blockType === 'text'
                    ? { id: ev.blockId, type: 'text', content: ev.content || '' }
                    : { id: ev.blockId, type: 'tool_use', toolName: ev.toolName || '', toolInput: {} };
              blocks.push(fullBlock);
              // tool_result → back to streaming/executing based on remaining blocks
              break;
            }
            case 'message_complete':
              return { messages: msgs.slice(0, idx).concat([{ ...assistant, blocks, partial: false, status: 'done' as ExecutionStatus } as ChatMessage], msgs.slice(idx + 1)), loading: false, abortController: null };
          }

          return { messages: msgs.slice(0, idx).concat([{ ...assistant, blocks } as ChatMessage], msgs.slice(idx + 1)) };
        });
      };

      try {
        await callBridge(state.activeProvider, prompt, cwd, onEvent, controller.signal);
      } catch (e: any) {
        if (e?.name === 'AbortError') {
          set(s => {
            const msgs = [...s.messages];
            const idx = msgs.findIndex(m => m.id === assistantId);
            if (idx >= 0 && msgs[idx].role === 'assistant') {
              msgs[idx] = { ...msgs[idx], partial: false } as ChatMessage;
            }
            msgs.push({ id: nextMsgId(), role: 'user', content: '', timestamp: Date.now() });
            return { messages: msgs, loading: false, abortController: null };
          });
        } else {
          set(s => ({
            messages: [...s.messages.filter(m => m.id !== assistantId), { role: 'user', content: `Error: ${e}`, id: nextMsgId(), timestamp: Date.now() }],
            loading: false,
            abortController: null,
          }));
        }
      }
      get().startNextQueuedTask();
      return;
    }

    const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId);
    if (!ws || !state.activeConversationId) return;

    window.pigagent.onAgentMessage((agentMsg: any) => {
      set(s => ({ messages: [...s.messages, agentMsg] }));
    });

    window.pigagent.execute({
      provider: state.activeProvider,
      prompt,
      workspacePath: ws.path,
      conversationId: state.activeConversationId,
    });
  },

  startNextQueuedTask: () => {
    const state = get();
    if (state.loading || state.taskQueue.length === 0) return;
    const [next, ...rest] = state.taskQueue;
    set({ taskQueue: rest });
    void get().runQueuedTask(next.prompt);
  },

  removeQueuedTask: (id) => {
    set(s => ({ taskQueue: s.taskQueue.filter(task => task.id !== id) }));
  },

  clearTaskQueue: () => set({ taskQueue: [] }),

  buildAgentContext: (pendingPrompt) => {
    const state = get();
    return {
      recentMessages: buildRecentContextMessages(state.messages, pendingPrompt),
      memory: normalizeAgentMemory(state.agentMemory),
      workspaceMemory: normalizeWorkspaceMemory(state.workspaceMemory),
    };
  },

  updateMemoryFromEvent: (event) => {
    if (event.type !== 'tool_result' && event.type !== 'final') return;
    set(s => {
      const memory = normalizeAgentMemory(s.agentMemory);
      const workspaceMemory = normalizeWorkspaceMemory(s.workspaceMemory);
      const now = Date.now();

      if (event.type === 'tool_result') {
        const item = summarizeToolResult(event.name, event.ok, event.output);
        memory.toolSummaries = [
          ...memory.toolSummaries,
          { name: event.name, ok: event.ok, summary: item.summary, timestamp: now },
        ].slice(-50);

        const touchedPaths = item.paths?.length ? item.paths : item.path ? [item.path] : [];
        for (const touchedPath of touchedPaths) {
          const fileRecord = { path: touchedPath, action: item.action || 'other', summary: item.summary, timestamp: now };
          memory.filesTouched = [
            ...memory.filesTouched.filter(file => !(file.path === touchedPath && file.action === item.action)),
            fileRecord,
          ].slice(-30);
          workspaceMemory.filesTouched = [
            ...workspaceMemory.filesTouched.filter(file => !(file.path === touchedPath && file.action === item.action)),
            fileRecord,
          ].slice(-60);
        }

        if (event.ok && item.path && item.artifactType) {
          const artifact = { path: item.path, type: item.artifactType, summary: item.summary, createdAt: now };
          memory.artifacts = [
            ...memory.artifacts.filter(artifact => artifact.path !== item.path),
            artifact,
          ].slice(-30);
          workspaceMemory.artifacts = [
            ...workspaceMemory.artifacts.filter(existing => existing.path !== item.path),
            artifact,
          ].slice(-60);
        }
      }

      if (event.type === 'final' && event.content?.trim()) {
        const finalSummary = event.content.trim().slice(0, 1200);
        memory.conversationSummary = [
          memory.conversationSummary,
          finalSummary,
        ].filter(Boolean).join('\n\n').slice(-4000);
        workspaceMemory.projectSummary = [
          workspaceMemory.projectSummary,
          finalSummary,
        ].filter(Boolean).join('\n\n').slice(-5000);
      }

      saveStoredMemory(s.activeConversationId, memory);
      saveStoredWorkspaceMemory(s.activeWorkspaceId, workspaceMemory);
      return { agentMemory: memory, workspaceMemory };
    });
  },

  stopGeneration: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
    }
  },

  regenerate: async () => {
    const { messages } = get();
    const lastUser = [...messages].reverse().find((m): m is Extract<ChatMessage, { role: 'user' }> => m.role === 'user' && Boolean(m.content));
    if (!lastUser) return;
    // Remove the last assistant message (and any trailing empty user messages)
    const lastIdx = messages.findLastIndex(m => m.role === 'assistant');
    if (lastIdx >= 0) {
      set(s => ({ messages: s.messages.slice(0, lastIdx) }));
    }
    get().sendMessage(lastUser.content);
  },

  setProvider: (provider) => {
    if (typeof window.pigagent === 'undefined') {
      localStorage.setItem(BROWSER_PROVIDER_KEY, provider);
    }
    set({ activeProvider: provider });
  },

  addContextFile: (path) => set(s => ({ contextFiles: [...s.contextFiles.filter(f => f !== path), path] })),
  removeContextFile: (path) => set(s => ({ contextFiles: s.contextFiles.filter(f => f !== path) })),
}));
