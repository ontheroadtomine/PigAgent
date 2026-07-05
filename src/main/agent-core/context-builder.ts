import { AgentContextPayload } from '../../shared/types';
import { ChatMessageWire } from './types';

const MAX_RECENT_MESSAGES = 10;
const MAX_MEMORY_ITEMS = 12;
const MAX_CONTEXT_CHARS = 32_000;

function trimText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[truncated ${text.length - maxChars} chars]`;
}

function buildMemoryText(context?: AgentContextPayload): string {
  if (!context?.memory) return '';
  const { memory } = context;
  const sections: string[] = [];

  if (memory.conversationSummary?.trim()) {
    sections.push(`Conversation summary:\n${trimText(memory.conversationSummary.trim(), 4_000)}`);
  }

  if (memory.artifacts.length) {
    sections.push([
      'Recent artifacts:',
      ...memory.artifacts.slice(-MAX_MEMORY_ITEMS).map(item => `- ${item.path} (${item.type}): ${item.summary}`),
    ].join('\n'));
  }

  if (memory.filesTouched.length) {
    sections.push([
      'Recently touched files:',
      ...memory.filesTouched.slice(-MAX_MEMORY_ITEMS).map(item => `- ${item.action}: ${item.path}${item.summary ? ` — ${item.summary}` : ''}`),
    ].join('\n'));
  }

  if (memory.toolSummaries.length) {
    sections.push([
      'Recent tool results:',
      ...memory.toolSummaries.slice(-MAX_MEMORY_ITEMS).map(item => `- ${item.name}: ${item.ok ? 'ok' : 'failed'} — ${item.summary}`),
    ].join('\n'));
  }

  if (!sections.length) return '';
  return [
    'Use this local conversation memory to resolve references such as "刚才", "上一步", "那个文件", or "继续".',
    'Do not treat memory as proof when current workspace files contradict it; read files again when exact content matters.',
    '',
    ...sections,
  ].join('\n');
}

export function buildContextMessages(context?: AgentContextPayload): ChatMessageWire[] {
  const messages: ChatMessageWire[] = [];
  let remainingChars = MAX_CONTEXT_CHARS;
  const memoryText = buildMemoryText(context);
  if (memoryText) {
    const content = trimText(memoryText, Math.min(remainingChars, 10_000));
    remainingChars -= content.length;
    messages.push({ role: 'system', content });
  }

  const recent = (context?.recentMessages || []).slice(-MAX_RECENT_MESSAGES);
  for (const message of recent) {
    if (remainingChars <= 0) break;
    const content = trimText(message.content.trim(), Math.min(6_000, remainingChars));
    if (!content) continue;
    remainingChars -= content.length;
    messages.push({ role: message.role, content });
  }

  return messages;
}
