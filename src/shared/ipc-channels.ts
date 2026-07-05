// IPC channel constants — shared between Main and Renderer
export const IPC = {
  AGENT_EXECUTE: 'agent:execute',
  AGENT_ABORT: 'agent:abort',
  AGENT_LIST: 'agent:list',
  AGENT_MODELS: 'agent:models',
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_WATCH: 'file:watch',
  SESSION_RESUME: 'session:resume',
  SESSION_HISTORY: 'session:history',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  LLM_API_TEST: 'llm-api:test',
  LLM_API_CHAT: 'llm-api:chat',
  LLM_API_STREAM: 'llm-api:stream',
  WORKSPACE_ADD: 'workspace:add',
  WORKSPACE_LIST: 'workspace:list',
  DIALOG_SELECT_DIRECTORY: 'dialog:select-directory',
  CONVERSATION_CREATE: 'conversation:create',
  CONVERSATION_LIST: 'conversation:list',
  CONVERSATION_UPDATE: 'conversation:update',
} as const;

export const IPC_EVENTS = {
  AGENT_MESSAGE: 'agent:message',
  AGENT_RESULT: 'agent:result',
  LLM_API_STREAM_EVENT: 'llm-api:stream:event',
  FILE_CHANGED: 'file:changed',
} as const;
