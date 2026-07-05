import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { agentRuntime } from './agent-runtime/runtime';
import { providerRegistry } from './agent-runtime/provider-registry';
import { prepareEnv } from './agent-runtime/execenv';
import { SessionManager } from './session-manager';
import { chatWithLlmApi, testLlmApi } from './llm-api';
import { AgentContextPayload, AgentMessage, Conversation, LlmApiConfig, Workspace } from '../shared/types';
import * as path from 'path';
import * as os from 'os';

const configDir = path.join(os.homedir(), '.pigagent');
let sessionManager: SessionManager;

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function registerIpcHandlers(getMainWindow: () => BrowserWindow | null) {
  sessionManager = new SessionManager(configDir);

  // ---- Agent ----
  ipcMain.handle(IPC.AGENT_LIST, async () => {
    return providerRegistry.list();
  });

  ipcMain.handle(IPC.AGENT_EXECUTE, async (event, params: {
    provider: string; prompt: string; workspacePath: string;
    conversationId: string; model?: string; resumeSessionId?: string;
  }) => {
    const mainWindow = getMainWindow();
    if (!mainWindow) throw new Error('No main window');

    const env = await prepareEnv({
      workspacePath: params.workspacePath,
      conversationId: params.conversationId,
      issueTitle: params.prompt.slice(0, 100),
    });

    const { messages } = await agentRuntime.execute(params.provider, params.prompt, {
      cwd: env.workDir,
      model: params.model,
      resumeSessionId: params.resumeSessionId,
    });

    // Stream messages back to renderer
    (async () => {
      for await (const msg of messages) {
        mainWindow.webContents.send('agent:message', msg);
      }
      // Send completion
      mainWindow.webContents.send('agent:result', { success: true, duration: 0 });
    })();

    return { success: true };
  });

  ipcMain.handle(IPC.AGENT_ABORT, async (event, sessionId: string) => {
    return agentRuntime.abort(sessionId);
  });

  // ---- Workspace ----
  ipcMain.handle(IPC.WORKSPACE_LIST, async () => {
    return sessionManager.listWorkspaces();
  });

  ipcMain.handle(IPC.WORKSPACE_ADD, async (event, { name, dirPath }: { name: string; dirPath: string }) => {
    const ws: Workspace = { id: generateId(), name, path: dirPath, createdAt: Date.now() };
    sessionManager.addWorkspace(ws);
    return ws;
  });

  // ---- Conversation ----
  ipcMain.handle(IPC.CONVERSATION_CREATE, async (event, { workspaceId, title }: { workspaceId: string; title: string }) => {
    const conv: Conversation = {
      id: generateId(), workspaceId, title,
      createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0,
    };
    sessionManager.createConversation(conv);
    return conv;
  });

  ipcMain.handle(IPC.CONVERSATION_LIST, async (event, workspaceId: string) => {
    return sessionManager.listConversations(workspaceId);
  });

  // ---- Settings ----
  ipcMain.handle(IPC.SETTINGS_GET, async () => {
    return sessionManager.getSettings();
  });

  ipcMain.handle(IPC.SETTINGS_SET, async (event, settings) => {
    sessionManager.saveSettings(settings);
    return true;
  });

  ipcMain.handle(IPC.LLM_API_TEST, async (event, config: LlmApiConfig) => {
    return testLlmApi(config);
  });

  ipcMain.handle(IPC.LLM_API_CHAT, async (event, { config, prompt, cwd, context }: { config: LlmApiConfig; prompt: string; cwd?: string; context?: AgentContextPayload }) => {
    return chatWithLlmApi(config, prompt, cwd, context);
  });

  // ---- File operations ----
  ipcMain.handle(IPC.FILE_READ, async (event, filePath: string) => {
    const fs = require('fs');
    return fs.promises.readFile(filePath, 'utf-8');
  });

  ipcMain.handle(IPC.FILE_WRITE, async (event, { path: filePath, content }: { path: string; content: string }) => {
    const fs = require('fs');
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return true;
  });

  // Scan providers on startup
  providerRegistry.scan().then((providers) => {
    console.log('[PigAgent] Detected providers:', providers.filter(p => p.available).map(p => p.name));
  });
}
