import { LlmApiConfig } from '../../shared/types';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessageWire {
  role: ChatRole;
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCallWire[];
}

export interface ToolCallWire {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AgentToolContext {
  cwd: string;
}

export interface AgentToolResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface AgentTool {
  name: string;
  schema: AgentToolSchema;
  run(args: Record<string, unknown>, context: AgentToolContext): Promise<unknown>;
}

export interface AgentLoopOptions {
  config: LlmApiConfig;
  apiKey: string;
  prompt: string;
  cwd: string;
  signal?: AbortSignal;
  maxTurns?: number;
  onEvent?: (event: AgentLoopEvent) => void;
}

export interface AgentLoopResult {
  content: string;
  turns: number;
  toolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    ok: boolean;
    output?: string;
  }>;
}

export type AgentLoopEvent =
  | { type: 'status'; status: 'thinking' | 'executing' | 'post_tool' | 'streaming'; message?: string }
  | { type: 'tool_start'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; output: string }
  | { type: 'text_start' }
  | { type: 'text_delta'; delta: string };
