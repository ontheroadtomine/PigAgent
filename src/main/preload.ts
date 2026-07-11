import { contextBridge, ipcRenderer } from 'electron';
import { IPC, IPC_EVENTS } from '../shared/ipc-channels';
import { ProviderInfo, Workspace, Conversation, AppSettings, AgentConfig, AgentMessage, LlmApiChatEvent, LlmApiChatResult, LlmApiConfig, LlmApiTestResult, AgentContextPayload } from '../shared/types';

const api = {
  // Agent
  execute: (params: { provider: string; prompt: string; workspacePath: string; conversationId: string; model?: string }) =>
    ipcRenderer.invoke(IPC.AGENT_EXECUTE, params),
  abort: (sessionId: string) => ipcRenderer.invoke(IPC.AGENT_ABORT, sessionId),
  listProviders: (): Promise<ProviderInfo[]> => ipcRenderer.invoke(IPC.AGENT_LIST),

  // Workspace
  listWorkspaces: (): Promise<Workspace[]> => ipcRenderer.invoke(IPC.WORKSPACE_LIST),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.DIALOG_SELECT_DIRECTORY),
  addWorkspace: (name: string, dirPath: string): Promise<Workspace> => ipcRenderer.invoke(IPC.WORKSPACE_ADD, { name, dirPath }),

  // Conversation
  createConversation: (workspaceId: string, title: string): Promise<Conversation> =>
    ipcRenderer.invoke(IPC.CONVERSATION_CREATE, { workspaceId, title }),
  listConversations: (workspaceId: string): Promise<Conversation[]> => ipcRenderer.invoke(IPC.CONVERSATION_LIST, workspaceId),
  renameConversation: (id: string, title: string): Promise<Conversation> =>
    ipcRenderer.invoke(IPC.CONVERSATION_UPDATE, { id, title }),

  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke(IPC.SETTINGS_SET, settings),
  testLlmApi: (config: LlmApiConfig): Promise<LlmApiTestResult> => ipcRenderer.invoke(IPC.LLM_API_TEST, config),
  chatLlmApi: (config: LlmApiConfig, prompt: string, cwd?: string, context?: AgentContextPayload): Promise<LlmApiChatResult> => ipcRenderer.invoke(IPC.LLM_API_CHAT, { config, prompt, cwd, context }),
  streamLlmApi: async (
    config: LlmApiConfig,
    prompt: string,
    cwd: string | undefined,
    context: AgentContextPayload | undefined,
    callback: (event: LlmApiChatEvent) => void,
  ): Promise<void> => {
    const streamId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    let resolveTerminalEvent: () => void = () => {};
    const terminalEvent = new Promise<void>((resolve) => {
      resolveTerminalEvent = resolve;
    });
    const handler = (_event: Electron.IpcRendererEvent, payload: { streamId: string; event: LlmApiChatEvent }) => {
      if (payload.streamId !== streamId) return;
      callback(payload.event);
      if (payload.event.type === 'final' || payload.event.type === 'error') {
        ipcRenderer.removeListener(IPC_EVENTS.LLM_API_STREAM_EVENT, handler);
        resolveTerminalEvent();
      }
    };
    ipcRenderer.on(IPC_EVENTS.LLM_API_STREAM_EVENT, handler);
    try {
      await Promise.all([
        ipcRenderer.invoke(IPC.LLM_API_STREAM, { streamId, config, prompt, cwd, context }),
        terminalEvent,
      ]);
    } finally {
      ipcRenderer.removeListener(IPC_EVENTS.LLM_API_STREAM_EVENT, handler);
    }
  },

  // File
  readFile: (filePath: string): Promise<string> => ipcRenderer.invoke(IPC.FILE_READ, filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke(IPC.FILE_WRITE, { path: filePath, content }),

  // Events (Main → Renderer)
  onAgentMessage: (callback: (msg: AgentMessage) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, msg: AgentMessage) => callback(msg);
    ipcRenderer.on(IPC_EVENTS.AGENT_MESSAGE, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.AGENT_MESSAGE, handler);
  },
  onAgentResult: (callback: (result: { success: boolean; error?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: { success: boolean; error?: string }) => callback(result);
    ipcRenderer.on(IPC_EVENTS.AGENT_RESULT, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.AGENT_RESULT, handler);
  },
  onFileChanged: (callback: (data: { path: string; diff?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { path: string; diff?: string }) => callback(data);
    ipcRenderer.on(IPC_EVENTS.FILE_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC_EVENTS.FILE_CHANGED, handler);
  },
};

contextBridge.exposeInMainWorld('nexa', api);

export type NexaApi = typeof api;
