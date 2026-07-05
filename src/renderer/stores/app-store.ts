import { create } from 'zustand';
import { Workspace, Conversation, AgentConfig, AppSettings, ChatMessage, ContentBlock, BridgeEvent, ExecutionStatus, LlmApiChatEvent, LlmApiChatResult, LlmApiConfig } from '../../shared/types';

const BRIDGE_URL = 'http://localhost:9876';
const BROWSER_SETTINGS_KEY = 'pigagent.settings';
const BROWSER_PROVIDER_KEY = 'pigagent.activeProvider';

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

function normalizeLlmApiConfig(config: LlmApiConfig): LlmApiConfig {
  const legacy = config as LlmApiConfig & { envFile?: string; envVar?: string };
  return {
    ...config,
    apiKeyEnvVar: config.apiKeyEnvVar || legacy.envVar,
    envFilePath: config.envFilePath || legacy.envFile,
  };
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

  init: () => Promise<void>;
  toggleSettings: () => void;
  saveSettings: (settings: AppSettings) => Promise<void>;

  addWorkspace: (name: string, path: string) => Promise<Workspace>;
  toggleWorkspace: (id: string) => void;

  createConversation: (workspaceId: string, title: string) => Promise<Conversation>;
  selectConversation: (conv: Conversation) => void;

  sendMessage: (prompt: string) => Promise<void>;
  runQueuedTask: (prompt: string) => Promise<void>;
  startNextQueuedTask: () => void;
  removeQueuedTask: (id: string) => void;
  clearTaskQueue: () => void;
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

async function callBridgeLlmApi(config: LlmApiConfig, prompt: string, cwd: string, signal?: AbortSignal): Promise<LlmApiChatResult> {
  const res = await fetch(`${BRIDGE_URL}/llm-api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, prompt, cwd }),
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
  onEvent: (event: LlmApiChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BRIDGE_URL}/llm-api/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, prompt, cwd }),
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
      return { messages: msgs };
    }

    if (event.type === 'tool_result') {
      blocks.push({
        id: `${assistantId}_tool_result_${blocks.length}`,
        type: 'tool_result',
        toolName: event.name,
        toolOutput: event.output,
      });
      msgs[idx] = { ...assistant, blocks, status: 'thinking', partial: true };
      return { messages: msgs };
    }

    if (event.type === 'final') {
      const finalBlocks = blocks.filter(block => !(block.type === 'thinking' && block.id === `${assistantId}_status`));
      finalBlocks.push({ id: `${assistantId}_final`, type: 'text', content: event.content });
      msgs[idx] = { ...assistant, blocks: finalBlocks, status: 'done', partial: false };
      return { messages: msgs, loading: false, abortController: null };
    }

    if (event.type === 'error') {
      blocks.push({ id: `${assistantId}_error`, type: 'text', content: `Error: ${event.error}` });
      msgs[idx] = { ...assistant, blocks, status: 'done', partial: false };
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
      const defaultProvider = settings.llmApis.find(api => api.enabled)?.id
        ? `llm:${settings.llmApis.find(api => api.enabled)!.id}`
        : infos.filter((p: ProviderInfo) => p.available)[0]?.name || 'claude';
      set({
        initialized: true,
        workspaces: [
          { id: 'ws1', name: 'pigagent', path: '/Users/lapisy/PigAgent', createdAt: Date.now() },
        ],
        activeWorkspaceId: 'ws1',
        expandedWorkspaces: new Set(['ws1']),
        conversations: [
          { id: 'c1', workspaceId: 'ws1', title: 'New conversation', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 },
        ],
        activeConversationId: 'c1',
        settings,
        providerInfos: infos,
        activeProvider: savedProvider || defaultProvider,
      });
      return;
    }
    try {
      const [workspaces, settings, providers] = await Promise.all([
        window.pigagent.listWorkspaces(),
        window.pigagent.getSettings(),
        window.pigagent.listProviders(),
      ]);
      const activeWsId = workspaces[0]?.id || null;
      let convs: Conversation[] = [];
      if (activeWsId) {
        convs = await window.pigagent.listConversations(activeWsId);
      }
      set({
        initialized: true,
        workspaces,
        activeWorkspaceId: activeWsId,
        expandedWorkspaces: activeWsId ? new Set([activeWsId]) : new Set(),
        conversations: convs,
        activeConversationId: convs[0]?.id || null,
        settings,
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
    if (typeof window.pigagent === 'undefined') {
      const ws: Workspace = { id: Date.now().toString(36), name, path: dirPath, createdAt: Date.now() };
      set(s => ({ workspaces: [ws, ...s.workspaces], expandedWorkspaces: new Set([...s.expandedWorkspaces, ws.id]) }));
      return ws;
    }
    const ws = await window.pigagent.addWorkspace(name, dirPath);
    set(s => ({ workspaces: [ws, ...s.workspaces], expandedWorkspaces: new Set([...s.expandedWorkspaces, ws.id]) }));
    return ws;
  },

  toggleWorkspace: (id) => set(s => {
    const next = new Set(s.expandedWorkspaces);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { expandedWorkspaces: next };
  }),

  createConversation: async (workspaceId, title) => {
    if (typeof window.pigagent === 'undefined') {
      const conv: Conversation = { id: Date.now().toString(36), workspaceId, title, createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 };
      set(s => ({ conversations: [conv, ...s.conversations], activeConversationId: conv.id, messages: [] }));
      return conv;
    }
    const conv = await window.pigagent.createConversation(workspaceId, title);
    set(s => ({ conversations: [conv, ...s.conversations], activeConversationId: conv.id, messages: [] }));
    return conv;
  },

  selectConversation: (conv) => set({ activeConversationId: conv.id, messages: [] }),

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

    set(s => ({ messages: [...s.messages, userMsg, assistantMsg], loading: true, abortController: controller }));

    const selectedLlmApi = getSelectedLlmApi(state.settings, state.activeProvider);
    if (selectedLlmApi) {
      const assistantId = assistantMsg.id;
      const ws = state.workspaces.find(w => w.id === state.activeWorkspaceId);
      const cwd = ws?.path || '/tmp';
      set(updateAssistantFromLlmEvent(assistantId, { type: 'status', status: 'thinking', message: '分析任务' }));
      try {
        if (typeof window.pigagent !== 'undefined') {
          const result = await window.pigagent.chatLlmApi(selectedLlmApi, prompt, cwd);
          if (!result.ok) throw new Error(result.error || 'LLM API request failed');
          set(completeAssistant(assistantId, result.content || '', result.toolCalls));
        } else {
          await streamBridgeLlmApi(selectedLlmApi, prompt, cwd, event => {
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

  stopGeneration: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
    }
  },

  regenerate: async () => {
    const { messages } = get();
    const lastUser = [...messages].reverse().find(m => m.role === 'user' && m.content);
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
