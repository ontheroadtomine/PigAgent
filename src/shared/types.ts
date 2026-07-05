// Shared types between main and renderer processes

// —— Content blocks that make up an assistant message ——

export type ContentBlock =
  | { id: string; type: 'thinking'; content: string }
  | { id: string; type: 'text'; content: string }
  | { id: string; type: 'tool_use'; toolName: string; toolInput: Record<string, unknown> }
  | { id: string; type: 'tool_result'; toolName: string; toolOutput: string };

// —— Execution status ——

export type ExecutionStatus = 'connecting' | 'thinking' | 'executing' | 'post_tool' | 'streaming' | 'done';

// —— Chat messages ——

export interface UserMessage {
  id: string;
  role: 'user';
  content: string;
  timestamp: number;
}

export interface AssistantMessage {
  id: string;
  role: 'assistant';
  blocks: ContentBlock[];
  partial: boolean;
  status: ExecutionStatus;
  timestamp: number;
}

export type ChatMessage = UserMessage | AssistantMessage;

// —— SSE events from bridge to renderer ——

export type BridgeEvent =
  | { type: 'block_start'; blockId: string; blockType: ContentBlock['type']; toolName?: string }
  | { type: 'block_delta'; blockId: string; delta: string }
  | { type: 'block_full'; blockId: string; blockType: ContentBlock['type']; content?: string; toolName?: string; toolOutput?: string }
  | { type: 'message_complete'; subtype?: string; durationMs?: number }
  | { type: 'error'; error: string };

export interface AgentResult {
  success: boolean;
  error?: string;
  usage?: TokenUsage;
  duration: number;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export type AgentMessage =
  | { role: 'assistant'; type: 'text'; content?: string; timestamp: number }
  | { role: 'assistant'; type: 'thinking'; content?: string; timestamp: number }
  | { role: 'assistant'; type: 'tool_use'; toolName?: string; toolInput?: unknown; timestamp: number }
  | { role: 'assistant'; type: 'tool_result'; toolName?: string; toolOutput?: string; timestamp: number }
  | { role: 'assistant'; type: 'status'; status: string; sessionId?: string; timestamp: number };

export interface ExecOptions {
  cwd: string;
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
  timeout?: number;
  resumeSessionId?: string;
  extraArgs?: string[];
}

export interface ProviderInfo {
  name: string;
  executablePath: string;
  version: string;
  available: boolean;
  models?: ModelInfo[];
}

export interface ModelInfo {
  id: string;
  name: string;
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  protocol: 'stream-json' | 'acp';
  enabled: boolean;
  createdAt: number;
}

export type LlmApiProvider = 'deepseek' | 'openai-compatible';

export interface LlmApiConfig {
  id: string;
  name: string;
  provider: LlmApiProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  envFilePath?: string;
  enabled: boolean;
}

export interface LlmApiTestResult {
  ok: boolean;
  providerId: string;
  model: string;
  latencyMs: number;
  message?: string;
  error?: string;
}

export interface LlmApiChatResult {
  ok: boolean;
  providerId: string;
  model: string;
  content?: string;
  latencyMs: number;
  error?: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    ok: boolean;
  }>;
}

export type LlmApiChatEvent =
  | { type: 'status'; status: ExecutionStatus; message?: string }
  | { type: 'tool_start'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; output: string }
  | { type: 'text_start' }
  | { type: 'text_delta'; delta: string }
  | { type: 'final'; content?: string; latencyMs: number }
  | { type: 'error'; error: string };

export interface AppSettings {
  theme: 'light' | 'dark';
  autoApprove: boolean;
  agents: AgentConfig[];
  llmApis: LlmApiConfig[];
}
