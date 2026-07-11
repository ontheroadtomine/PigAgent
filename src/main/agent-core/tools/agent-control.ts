import { AgentTool } from '../types';
import { truncateText } from './shared';

export const planUpdateTool: AgentTool = {
  name: 'plan_update',
  schema: {
    type: 'function',
    function: {
      name: 'plan_update',
      description: 'Record or update the current task plan. Use this for multi-step work so the user can understand progress.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Short plan summary.' },
          steps: {
            type: 'array',
            description: 'Plan steps with status.',
            items: {
              type: 'object',
              properties: {
                step: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked'] },
              },
              required: ['step', 'status'],
            },
          },
        },
        required: ['steps'],
      },
    },
  },
  async run(args) {
    const steps = Array.isArray(args.steps) ? args.steps : [];
    return {
      summary: String(args.summary || '').trim(),
      steps: steps.map((item: any) => ({
        step: String(item?.step || '').trim(),
        status: String(item?.status || 'pending'),
      })).filter(item => item.step),
      recordedAt: new Date().toISOString(),
    };
  },
};

export const askUserQuestionTool: AgentTool = {
  name: 'ask_user_question',
  schema: {
    type: 'function',
    function: {
      name: 'ask_user_question',
      description: 'Use only when required information is missing and continuing would be risky or impossible. Returns a structured prompt for the final assistant response.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The concise question to ask the user.' },
          reason: { type: 'string', description: 'Why the answer is needed.' },
          choices: {
            type: 'array',
            description: 'Optional suggested choices.',
            items: { type: 'string' },
          },
        },
        required: ['question'],
      },
    },
  },
  async run(args) {
    return {
      requiresUserInput: true,
      question: String(args.question || '').trim(),
      reason: String(args.reason || '').trim(),
      choices: Array.isArray(args.choices) ? args.choices.map(String).slice(0, 5) : [],
    };
  },
};

export const contextCompactTool: AgentTool = {
  name: 'context_compact',
  schema: {
    type: 'function',
    function: {
      name: 'context_compact',
      description: 'Compact long text, logs, or tool results into a shorter summary while preserving decisions, files, errors, and next steps.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Long text to compact.' },
          focus: { type: 'string', description: 'Optional focus for the summary.' },
          maxChars: { type: 'number', description: 'Maximum characters in compacted output. Defaults to 4000.' },
        },
        required: ['text'],
      },
    },
  },
  async run(args) {
    const text = String(args.text || '');
    const focus = String(args.focus || '').trim();
    const maxChars = Math.max(500, Math.min(Number(args.maxChars || 4_000), 20_000));
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const important = lines.filter(line => {
      const lower = line.toLowerCase();
      return (
        lower.includes('error') ||
        lower.includes('failed') ||
        lower.includes('warning') ||
        lower.includes('todo') ||
        lower.includes('next') ||
        lower.includes('file') ||
        lower.includes('path') ||
        lower.includes('decision') ||
        /(^|\s)(src|docs|config|scripts)\//.test(line)
      );
    });
    const sample = [...important.slice(0, 80), ...lines.slice(-40)];
    const compacted = [
      focus ? `Focus: ${focus}` : '',
      `Original length: ${text.length} chars`,
      '',
      ...sample,
    ].filter(Boolean).join('\n');
    return {
      focus,
      originalChars: text.length,
      compacted: truncateText(compacted, maxChars),
    };
  },
};

export const artifactRecordTool: AgentTool = {
  name: 'artifact_record',
  schema: {
    type: 'function',
    function: {
      name: 'artifact_record',
      description: 'Record an important artifact created or changed during the task, such as a document, report, patch, or code file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Artifact path or URL.' },
          type: { type: 'string', enum: ['doc', 'patch', 'report', 'code', 'other'] },
          summary: { type: 'string', description: 'What the artifact contains and why it matters.' },
        },
        required: ['path', 'summary'],
      },
    },
  },
  async run(args) {
    return {
      path: String(args.path || '').trim(),
      type: String(args.type || 'other'),
      summary: String(args.summary || '').trim(),
      recordedAt: new Date().toISOString(),
    };
  },
};
