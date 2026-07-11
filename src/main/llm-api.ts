import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentContextPayload, LlmApiChatEvent, LlmApiChatResult, LlmApiConfig, LlmApiTestResult } from '../shared/types';
import { createDefaultToolRegistry } from './agent-core/default-tools';
import { AgentLoop, requestChatCompletion } from './agent-core/loop';

const DEFAULT_TIMEOUT_MS = 30_000;
const AGENT_LOOP_TIMEOUT_MS = 30 * 60_000;

function expandHome(filePath: string): string {
  if (filePath === '~') return os.homedir();
  if (filePath.startsWith('~/')) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function parseEnvFile(filePath?: string): Record<string, string> {
  if (!filePath) return {};
  const resolved = expandHome(filePath);
  if (!fs.existsSync(resolved)) return {};

  const env: Record<string, string> = {};
  const content = fs.readFileSync(resolved, 'utf-8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
  return env;
}

function resolveApiKey(config: LlmApiConfig): string {
  const normalizeKey = (value: string): string => value.trim().replace(/^Bearer\s+/i, '').trim();

  if (config.apiKey?.trim()) return normalizeKey(config.apiKey);

  const legacyConfig = config as LlmApiConfig & { envFile?: string; envVar?: string };
  const envFilePath = config.envFilePath || legacyConfig.envFile;
  const apiKeyEnvVar = config.apiKeyEnvVar || legacyConfig.envVar;
  const envFile = parseEnvFile(envFilePath);
  const fallbackCandidates = config.id.includes('deepseek') || config.provider === 'deepseek'
    ? ['DEEPSEEK_API_KEY', 'DEEPSEEK_SECRET_KEY', 'DEEPSEEK_SECRENT_KEY']
    : [];
  const candidates = Array.from(new Set([
    apiKeyEnvVar,
    ...fallbackCandidates,
  ].filter(Boolean) as string[]));

  for (const name of candidates) {
    const value = envFile[name] || process.env[name];
    if (value?.trim()) return normalizeKey(value);
  }

  if (candidates.length) {
    throw new Error(`Missing API key. Set ${candidates.join(' or ')} in the env file, or paste a key in settings.`);
  }
  throw new Error('Missing API key. Paste a key in settings.');
}

export async function testLlmApi(config: LlmApiConfig): Promise<LlmApiTestResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const apiKey = resolveApiKey(config);
    const data = await requestChatCompletion(config, apiKey, {
      messages: [
        { role: 'system', content: 'You are a concise API health-check assistant.' },
        { role: 'user', content: 'Reply with OK.' },
      ],
      max_tokens: 16,
      temperature: 0,
      stream: false,
    }, controller.signal);

    return {
      ok: true,
      providerId: config.id,
      model: config.model,
      latencyMs: Date.now() - started,
      message: data?.choices?.[0]?.message?.content?.trim() || 'Connected',
    };
  } catch (error: any) {
    return {
      ok: false,
      providerId: config.id,
      model: config.model,
      latencyMs: Date.now() - started,
      error: error?.name === 'AbortError' ? 'Request timed out' : String(error?.message || error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function chatWithLlmApi(config: LlmApiConfig, prompt: string, cwd = process.cwd(), context?: AgentContextPayload): Promise<LlmApiChatResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_LOOP_TIMEOUT_MS);

  try {
    const apiKey = resolveApiKey(config);
    const loop = new AgentLoop(createDefaultToolRegistry());
    const result = await loop.run({
      config,
      apiKey,
      prompt,
      cwd,
      context,
      signal: controller.signal,
    });

    return {
      ok: true,
      providerId: config.id,
      model: config.model,
      content: result.content,
      latencyMs: Date.now() - started,
      toolCalls: result.toolCalls,
    };
  } catch (error: any) {
    return {
      ok: false,
      providerId: config.id,
      model: config.model,
      latencyMs: Date.now() - started,
      error: error?.name === 'AbortError' ? `Agent task timed out after ${Math.round(AGENT_LOOP_TIMEOUT_MS / 1000)} seconds` : String(error?.message || error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function streamChatWithLlmApi(
  config: LlmApiConfig,
  prompt: string,
  cwd: string,
  context: AgentContextPayload | undefined,
  emit: (event: LlmApiChatEvent) => void,
): Promise<void> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AGENT_LOOP_TIMEOUT_MS);

  try {
    const apiKey = resolveApiKey(config);
    const loop = new AgentLoop(createDefaultToolRegistry());
    const result = await loop.run({
      config,
      apiKey,
      prompt,
      cwd,
      context,
      signal: controller.signal,
      onEvent: event => emit(event),
    });
    emit({ type: 'final', content: result.content, latencyMs: Date.now() - started, toolCalls: result.toolCalls });
  } catch (error: any) {
    emit({ type: 'error', error: error?.name === 'AbortError' ? `Agent task timed out after ${Math.round(AGENT_LOOP_TIMEOUT_MS / 1000)} seconds` : String(error?.message || error) });
  } finally {
    clearTimeout(timeout);
  }
}
