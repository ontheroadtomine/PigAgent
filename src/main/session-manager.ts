import * as path from 'path';
import * as fs from 'fs';
import { Conversation, Workspace, AppSettings, AgentConfig } from '../shared/types';

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
      enabled: true,
    },
  ],
};

export class SessionManager {
  private configDir: string;
  private dbPath: string;

  constructor(configDir: string) {
    this.configDir = configDir;
    fs.mkdirSync(configDir, { recursive: true });
    this.dbPath = path.join(configDir, 'database.json');
    if (!fs.existsSync(this.dbPath)) {
      fs.writeFileSync(this.dbPath, JSON.stringify({ workspaces: [], conversations: [], settings: defaultSettings }, null, 2));
    }
  }

  private readDb() {
    try {
      return JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'));
    } catch {
      return { workspaces: [], conversations: [], settings: { ...defaultSettings } };
    }
  }

  private writeDb(data: unknown) {
    fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
  }

  addWorkspace(ws: Workspace): void {
    const db = this.readDb();
    if (!db.workspaces.find((w: Workspace) => w.id === ws.id)) {
      db.workspaces.push(ws);
      this.writeDb(db);
    }
  }

  listWorkspaces(): Workspace[] {
    return this.readDb().workspaces;
  }

  getWorkspace(id: string): Workspace | undefined {
    return this.readDb().workspaces.find((w: Workspace) => w.id === id);
  }

  createConversation(conv: Conversation): void {
    const db = this.readDb();
    db.conversations.push(conv);
    this.writeDb(db);
  }

  listConversations(workspaceId: string): Conversation[] {
    return this.readDb().conversations.filter((c: Conversation) => c.workspaceId === workspaceId);
  }

  updateConversation(id: string, updates: Partial<Conversation>) {
    const db = this.readDb();
    const idx = db.conversations.findIndex((c: Conversation) => c.id === id);
    if (idx !== -1) {
      db.conversations[idx] = { ...db.conversations[idx], ...updates };
      this.writeDb(db);
    }
  }

  getSettings(): AppSettings {
    const db = this.readDb();
    return {
      ...defaultSettings,
      ...(db.settings || {}),
      llmApis: db.settings?.llmApis || defaultSettings.llmApis,
    };
  }

  saveSettings(settings: AppSettings): void {
    const db = this.readDb();
    db.settings = settings;
    this.writeDb(db);
  }

  getAgents(): AgentConfig[] {
    return this.getSettings().agents;
  }

  addAgent(agent: AgentConfig): void {
    const settings = this.getSettings();
    settings.agents.push(agent);
    this.saveSettings(settings);
  }

  removeAgent(id: string): void {
    const settings = this.getSettings();
    settings.agents = settings.agents.filter((a: AgentConfig) => a.id !== id);
    this.saveSettings(settings);
  }
}
