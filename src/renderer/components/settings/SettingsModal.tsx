import React, { useMemo, useState } from 'react';
import { useAppStore } from '../../stores/app-store';
import { AgentConfig, LlmApiConfig, LlmApiTestResult, ProviderInfo } from '../../../shared/types';

const defaultDeepSeekConfig: LlmApiConfig = {
  id: 'deepseek',
  name: 'DeepSeek',
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  enabled: true,
};

const modelPresets: LlmApiConfig[] = [
  defaultDeepSeekConfig,
  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-reasoner', enabled: true },
  { id: 'openai-gpt-4o', name: 'OpenAI GPT-4o', provider: 'openai-compatible', baseUrl: 'https://api.openai.com', model: 'gpt-4o', enabled: true },
  { id: 'openai-gpt-4-1', name: 'OpenAI GPT-4.1', provider: 'openai-compatible', baseUrl: 'https://api.openai.com', model: 'gpt-4.1', enabled: true },
  { id: 'openai-o3', name: 'OpenAI o3', provider: 'openai-compatible', baseUrl: 'https://api.openai.com', model: 'o3', enabled: true },
  { id: 'openai-o4-mini', name: 'OpenAI o4-mini', provider: 'openai-compatible', baseUrl: 'https://api.openai.com', model: 'o4-mini', enabled: true },
  { id: 'anthropic-openrouter-sonnet', name: 'Claude Sonnet (OpenRouter)', provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api', model: 'anthropic/claude-sonnet-4', enabled: true },
  { id: 'anthropic-openrouter-opus', name: 'Claude Opus (OpenRouter)', provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api', model: 'anthropic/claude-opus-4', enabled: true },
  { id: 'xai-grok', name: 'xAI Grok', provider: 'openai-compatible', baseUrl: 'https://api.x.ai', model: 'grok-3', enabled: true },
  { id: 'gemini-2-5-pro', name: 'Gemini 2.5 Pro', provider: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.5-pro', enabled: true },
  { id: 'gemini-2-5-flash', name: 'Gemini 2.5 Flash', provider: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: 'gemini-2.5-flash', enabled: true },
  { id: 'mistral-large', name: 'Mistral Large', provider: 'openai-compatible', baseUrl: 'https://api.mistral.ai', model: 'mistral-large-latest', enabled: true },
  { id: 'perplexity-sonar', name: 'Perplexity Sonar', provider: 'openai-compatible', baseUrl: 'https://api.perplexity.ai', model: 'sonar-pro', enabled: true },
  { id: 'together-llama', name: 'Together Llama', provider: 'openai-compatible', baseUrl: 'https://api.together.xyz', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', enabled: true },
  { id: 'qwen-max', name: 'Qwen Max', provider: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode', model: 'qwen-max', enabled: true },
  { id: 'qwen-plus', name: 'Qwen Plus', provider: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode', model: 'qwen-plus', enabled: true },
  { id: 'kimi-k2', name: 'Moonshot Kimi K2', provider: 'openai-compatible', baseUrl: 'https://api.moonshot.cn', model: 'kimi-k2-0711-preview', enabled: true },
  { id: 'kimi-latest', name: 'Moonshot Kimi Latest', provider: 'openai-compatible', baseUrl: 'https://api.moonshot.cn', model: 'moonshot-v1-128k', enabled: true },
  { id: 'minimax-m3', name: 'MiniMax M3', provider: 'openai-compatible', baseUrl: 'https://api.minimax.io/v1', model: 'MiniMax-M3', enabled: true },
  { id: 'minimax-m25', name: 'MiniMax M2.5', provider: 'openai-compatible', baseUrl: 'https://api.minimax.io/v1', model: 'MiniMax-M2.5', enabled: true },
  { id: 'minimax-m1', name: 'MiniMax M1', provider: 'openai-compatible', baseUrl: 'https://api.minimax.io/v1', model: 'MiniMax-M1', enabled: true },
  { id: 'minimax-cn-m3', name: 'MiniMax CN M3', provider: 'openai-compatible', baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M3', enabled: true },
  { id: 'minimax-cn-m25', name: 'MiniMax CN M2.5', provider: 'openai-compatible', baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M2.5', enabled: true },
  { id: 'zhipu-glm-4', name: 'Zhipu GLM-4', provider: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-plus', enabled: true },
  { id: 'doubao-pro', name: 'Doubao Pro', provider: 'openai-compatible', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', model: 'doubao-pro-32k', enabled: true },
  { id: 'yi-large', name: 'Yi Large', provider: 'openai-compatible', baseUrl: 'https://api.lingyiwanwu.com', model: 'yi-large', enabled: true },
  { id: 'groq-llama', name: 'Groq Llama', provider: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', enabled: true },
  { id: 'siliconflow-qwen', name: 'SiliconFlow Qwen', provider: 'openai-compatible', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-72B-Instruct', enabled: true },
  { id: 'openrouter-auto', name: 'OpenRouter Auto', provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api', model: 'openrouter/auto', enabled: true },
  { id: 'ollama-local', name: 'Ollama Local', provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'llama3.1', enabled: true },
];

async function testLlmApiInBrowser(config: LlmApiConfig): Promise<LlmApiTestResult> {
  const response = await fetch('http://localhost:9876/llm-api/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  return response.json();
}

async function scanProvidersInBrowser(): Promise<ProviderInfo[]> {
  const response = await fetch('http://localhost:9876/providers');
  return response.json();
}

function providerProtocol(name: string): AgentConfig['protocol'] {
  return ['hermes', 'kimi', 'kiro'].includes(name) ? 'acp' : 'stream-json';
}

function providerDisplayName(name: string): string {
  const labels: Record<string, string> = {
    claude: 'Claude Code',
    codex: 'Codex CLI',
    opencode: 'OpenCode',
    hermes: 'Hermes',
    kimi: 'Kimi',
    kiro: 'Kiro',
  };
  return labels[name] || name;
}

function providerToAgent(provider: ProviderInfo, existing?: AgentConfig): AgentConfig {
  const now = Date.now();
  return {
    id: existing?.id || `cli-${provider.name}`,
    name: existing?.name || providerDisplayName(provider.name),
    command: provider.executablePath || provider.name,
    protocol: providerProtocol(provider.name),
    enabled: existing?.enabled ?? true,
    createdAt: existing?.createdAt || now,
  };
}

function mergeScannedAgents(currentAgents: AgentConfig[], providers: ProviderInfo[]): AgentConfig[] {
  const next = [...currentAgents];
  for (const provider of providers.filter(item => item.available)) {
    const index = next.findIndex(agent =>
      agent.id === `cli-${provider.name}`
      || agent.command === provider.executablePath
      || agent.name.toLowerCase() === providerDisplayName(provider.name).toLowerCase()
      || agent.name.toLowerCase() === provider.name.toLowerCase(),
    );
    if (index >= 0) {
      next[index] = providerToAgent(provider, next[index]);
    } else {
      next.push(providerToAgent(provider));
    }
  }
  return next;
}

function localOnlyLlmApi(config: LlmApiConfig): LlmApiConfig {
  const { apiKeyEnvVar, envFilePath, ...localConfig } = config;
  return localConfig;
}

export default function SettingsModal() {
  const { settings, toggleSettings, saveSettings } = useAppStore();
  const [agents, setAgents] = useState<AgentConfig[]>(settings.agents);
  const [llmApis, setLlmApis] = useState<LlmApiConfig[]>((settings.llmApis?.length ? settings.llmApis : [defaultDeepSeekConfig]).map(localOnlyLlmApi));
  const [selectedLlmId, setSelectedLlmId] = useState((settings.llmApis?.[0] || defaultDeepSeekConfig).id);
  const [showApiKey, setShowApiKey] = useState(false);
  const [addingAgent, setAddingAgent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scanningAgents, setScanningAgents] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, LlmApiTestResult>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const selectedLlm = useMemo(() => {
    return llmApis.find(api => api.id === selectedLlmId) || llmApis[0] || defaultDeepSeekConfig;
  }, [llmApis, selectedLlmId]);
  const groupedPresets = useMemo(() => {
    return modelPresets.reduce<Record<string, LlmApiConfig[]>>((groups, preset) => {
      const group = preset.name.split(' ')[0];
      groups[group] = [...(groups[group] || []), preset];
      return groups;
    }, {});
  }, []);

  const updateLlmApi = (id: string, patch: Partial<LlmApiConfig>) => {
    setTestResults(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setLlmApis(prev => {
      const list = prev.length ? prev : [defaultDeepSeekConfig];
      return list.map(api => api.id === id ? { ...api, ...patch } : api);
    });
  };

  const handleAddPreset = (preset: LlmApiConfig) => {
    setLlmApis(prev => {
      if (prev.some(api => api.id === preset.id)) return prev;
      return [...prev, localOnlyLlmApi(preset)];
    });
    setSelectedLlmId(preset.id);
  };

  const handleRemoveLlmApi = (id: string) => {
    setLlmApis(prev => {
      const next = prev.filter(api => api.id !== id);
      const fallback = next[0] || defaultDeepSeekConfig;
      if (id === selectedLlmId) setSelectedLlmId(fallback.id);
      return next.length ? next : [fallback];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings({ ...settings, agents, llmApis: llmApis.map(localOnlyLlmApi) });
      toggleSettings();
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (config: LlmApiConfig) => {
    setTestingId(config.id);
    setTestResults(prev => {
      const next = { ...prev };
      delete next[config.id];
      return next;
    });
    try {
      if (typeof window.nexa === 'undefined') {
        const result = await testLlmApiInBrowser(config);
        setTestResults(prev => ({ ...prev, [config.id]: result }));
        return;
      }
      const result = await window.nexa.testLlmApi(config);
      setTestResults(prev => ({ ...prev, [config.id]: result }));
    } catch (error: any) {
      setTestResults(prev => ({ ...prev, [config.id]: {
        ok: false,
        providerId: config.id,
        model: config.model,
        latencyMs: 0,
        error: String(error?.message || error),
      } }));
    } finally {
      setTestingId(null);
    }
  };

  const handleScanAgents = async () => {
    setScanningAgents(true);
    setScanMessage(null);
    try {
      const providers: ProviderInfo[] = typeof window.nexa === 'undefined'
        ? await scanProvidersInBrowser()
        : await window.nexa.listProviders();
      const available = providers.filter(provider => provider.available);
      setAgents(prev => mergeScannedAgents(prev, providers));
      const names = available.map(provider => providerDisplayName(provider.name)).join(', ');
      setScanMessage(available.length ? `Found ${available.length}: ${names}` : 'No supported CLI tools found in PATH.');
    } catch (error: any) {
      setScanMessage(`Scan failed: ${String(error?.message || error)}`);
    } finally {
      setScanningAgents(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={toggleSettings}>
      <div className="bg-white rounded-xl shadow-2xl w-[640px] max-h-[82vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <span className="font-semibold text-gray-800">Settings</span>
          <button onClick={toggleSettings} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-6">
          {/* Agents */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">Agents</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleScanAgents}
                  disabled={scanningAgents}
                  className="text-xs text-gray-600 hover:text-gray-900 font-medium disabled:opacity-50"
                  title="扫描本地已安装的 Codex、Claude、OpenCode、Hermes、Kimi、Kiro CLI"
                >
                  {scanningAgents ? 'Scanning...' : 'Scan CLI'}
                </button>
                <button onClick={() => setAddingAgent(true)} className="text-xs text-purple-600 hover:text-purple-700 font-medium">+ Add Agent</button>
              </div>
            </div>
            {scanMessage && (
              <div className={`mb-2 rounded-md border px-3 py-2 text-xs ${scanMessage.startsWith('Scan failed') ? 'border-red-100 bg-red-50 text-red-600' : 'border-gray-200 bg-gray-50 text-gray-500'}`}>
                {scanMessage}
              </div>
            )}
            <div className="space-y-2">
              {agents.map(agent => (
                <div key={agent.id} className="flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-lg bg-white">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${agent.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                    <div>
                      <div className="text-sm text-gray-800 font-medium">{agent.name}</div>
                      <div className="text-[10px] text-gray-400 font-mono">{agent.command} · {agent.protocol}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="text-xs text-gray-400 hover:text-gray-600 agent-edit-btn">✎</button>
                    <button
                      onClick={() => setAgents(prev => prev.filter(a => a.id !== agent.id))}
                      className="text-xs text-gray-400 hover:text-red-500"
                    >×</button>
                  </div>
                </div>
              ))}
              {agents.length === 0 && (
                <div className="text-xs text-gray-400 py-4 text-center">
                  No agents configured. Add one to get started.
                </div>
              )}
            </div>
          </div>

          {/* LLM APIs */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">Large Model APIs</span>
              <span className="text-[11px] text-gray-400">Add presets, then choose them from the chat input.</span>
            </div>
            <div className="space-y-3">
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-600">Model presets</span>
                  <span className="text-[10px] text-gray-400">API keys are saved locally in this app.</span>
                </div>
                <div className="max-h-44 overflow-y-auto pr-1 scrollbar-thin">
                  {Object.entries(groupedPresets).map(([group, presets]) => (
                    <div key={group} className="mb-2 last:mb-0">
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{group}</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {presets.map(preset => {
                          const added = llmApis.some(api => api.id === preset.id);
                          return (
                            <button
                              key={preset.id}
                              onClick={() => handleAddPreset(preset)}
                              className={`flex min-w-0 items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left transition ${added ? 'border-purple-100 bg-purple-50 text-purple-700' : 'border-gray-200 text-gray-600 hover:border-purple-200 hover:bg-purple-50/60'}`}
                              title={`${preset.baseUrl} · ${preset.model}`}
                            >
                              <span className="min-w-0 truncate text-xs">{preset.name}</span>
                              <span className="shrink-0 text-[10px] text-gray-400">{added ? 'Added' : 'Add'}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-3">
                <div className="rounded-lg border border-gray-200 bg-white p-2">
                  <div className="mb-2 px-1 text-xs font-medium text-gray-600">Added models</div>
                  <div className="max-h-72 space-y-1 overflow-y-auto pr-1 scrollbar-thin">
                    {llmApis.map(api => (
                      <button
                        key={api.id}
                        onClick={() => setSelectedLlmId(api.id)}
                        className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${api.id === selectedLlm.id ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-50'}`}
                      >
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${api.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
                        <span className="min-w-0 flex-1 truncate text-xs">{api.name}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
                    <div className="min-w-0">
                      <input
                        type="text"
                        value={selectedLlm.name}
                        onChange={e => updateLlmApi(selectedLlm.id, { name: e.target.value })}
                        className="w-full border-0 bg-transparent p-0 text-sm font-medium text-gray-800 outline-none"
                        placeholder="Model display name"
                      />
                      <div className="truncate text-[10px] text-gray-400 font-mono">{selectedLlm.model}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-gray-500">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={selectedLlm.enabled}
                          onChange={e => updateLlmApi(selectedLlm.id, { enabled: e.target.checked })}
                        />
                        Enabled
                      </label>
                      <button
                        onClick={() => handleRemoveLlmApi(selectedLlm.id)}
                        className="text-xs text-gray-400 hover:text-red-500"
                        title="Remove model"
                      >
                        ×
                      </button>
                    </div>
                  </div>

                  <div className="p-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Base URL</label>
                      <input
                        type="text"
                        value={selectedLlm.baseUrl}
                        onChange={e => updateLlmApi(selectedLlm.id, { baseUrl: e.target.value })}
                        className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-xs outline-none focus:border-purple-500 font-mono"
                        placeholder="https://api.openai.com"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Model</label>
                      <input
                        type="text"
                        value={selectedLlm.model}
                        onChange={e => updateLlmApi(selectedLlm.id, { model: e.target.value })}
                        className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-xs outline-none focus:border-purple-500 font-mono"
                        placeholder="gpt-4o"
                      />
                    </div>
                    <div className="col-span-2">
                      <div className="mb-1 flex items-center justify-between">
                        <label className="text-xs text-gray-500 block">API key</label>
                        <button
                          type="button"
                          onClick={() => setShowApiKey(value => !value)}
                          className="text-[11px] text-gray-400 hover:text-gray-700"
                        >
                          {showApiKey ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={selectedLlm.apiKey || ''}
                        onChange={e => updateLlmApi(selectedLlm.id, { apiKey: e.target.value })}
                        className="w-full border border-gray-200 rounded-md px-2.5 py-2 text-xs outline-none focus:border-purple-500 font-mono"
                        placeholder="Paste API key. It will be saved locally."
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </div>
                  </div>

                  <div className="px-3 py-2.5 border-t border-gray-100 flex items-center justify-between gap-3">
                    <div className={`text-xs truncate ${testResults[selectedLlm.id]?.ok ? 'text-green-600' : testResults[selectedLlm.id] ? 'text-red-500' : 'text-gray-400'}`}>
                      {testResults[selectedLlm.id]
                        ? testResults[selectedLlm.id].ok
                          ? `Connected in ${testResults[selectedLlm.id].latencyMs}ms · ${testResults[selectedLlm.id].message || 'OK'}`
                          : testResults[selectedLlm.id].error
                        : 'Test uses the configured OpenAI-compatible chat completions endpoint.'}
                    </div>
                    <button
                      onClick={() => handleTest(selectedLlm)}
                      disabled={testingId === selectedLlm.id}
                      className="px-3 py-1.5 border border-gray-200 rounded-md text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 shrink-0"
                    >
                      {testingId === selectedLlm.id ? 'Testing...' : 'Test API'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* General */}
          <div>
            <span className="text-sm font-medium text-gray-700">General</span>
            <div className="mt-3 space-y-2">
              <label className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg">
                <span className="text-sm text-gray-600">Theme</span>
                <select className="text-xs border border-gray-200 rounded px-2 py-1 outline-none">
                  <option>Light</option>
                  <option>Dark</option>
                </select>
              </label>
              <label className="flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg">
                <span className="text-sm text-gray-600">Auto-approve tools</span>
                <input type="checkbox" className="rounded" defaultChecked />
              </label>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
          <button onClick={toggleSettings} className="px-4 py-1.5 border border-gray-200 rounded-md text-xs text-gray-600 hover:bg-gray-50 mr-2">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-xs font-medium disabled:opacity-60">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Add Agent modal */}
      {addingAgent && <AddAgentModal onClose={() => setAddingAgent(false)} onAdd={(agent) => { setAgents(prev => [...prev, agent]); setAddingAgent(false); }} />}
    </div>
  );
}

function AddAgentModal({ onClose, onAdd }: { onClose: () => void; onAdd: (agent: AgentConfig) => void }) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [protocol, setProtocol] = useState<'stream-json' | 'acp'>('stream-json');

  const handleAdd = () => {
    if (!name.trim()) return;
    onAdd({
      id: Date.now().toString(36),
      name: name.trim(),
      command: command.trim(),
      protocol,
      enabled: true,
      createdAt: Date.now(),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[420px] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <span className="font-semibold text-gray-800">Add Agent</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500" placeholder="e.g. Claude Code" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Command</label>
            <input type="text" value={command} onChange={e => setCommand(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500 font-mono" placeholder="e.g. claude --output-format stream-json" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Protocol</label>
            <select value={protocol} onChange={e => setProtocol(e.target.value as 'stream-json' | 'acp')} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none">
              <option value="stream-json">stream-json</option>
              <option value="acp">ACP (JSON-RPC 2.0)</option>
            </select>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 border border-gray-200 rounded-md text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={handleAdd} className="px-4 py-1.5 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-xs font-medium">Add</button>
        </div>
      </div>
    </div>
  );
}
