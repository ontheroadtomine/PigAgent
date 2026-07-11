import * as http from 'http';
import { spawn, execSync, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { chatWithLlmApi, streamChatWithLlmApi, testLlmApi } from './llm-api';

const PORT = 9876;

// ── Provider scanning ──

interface ProviderInfo {
  name: string;
  displayName: string;
  available: boolean;
  version: string;
}

function scanProviders(): ProviderInfo[] {
  const all = [
    { name: 'claude', displayName: 'Claude · Sonnet' },
    { name: 'codex', displayName: 'Codex CLI' },
    { name: 'opencode', displayName: 'OpenCode' },
    { name: 'hermes', displayName: 'Hermes' },
    { name: 'kimi', displayName: 'Kimi CLI' },
    { name: 'kiro', displayName: 'Kiro' },
  ];
  return all.map((p) => {
    try {
      const out = execSync(`${p.name} --version 2>&1`, { encoding: 'utf8', timeout: 5000 }).trim().split('\n')[0];
      return { ...p, available: true, version: out };
    } catch {
      return { ...p, available: false, version: '' };
    }
  });
}

function setCors(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendSSE(res: http.ServerResponse, data: unknown) {
  if (res.writableEnded) return;
  res.write(`event: message\ndata: ${JSON.stringify(data)}\n\n`);
}

function sendBlockStart(res: http.ServerResponse, blockId: string, blockType: string, toolName?: string) {
  sendSSE(res, { type: 'block_start', blockId, blockType, toolName });
}

function sendBlockDelta(res: http.ServerResponse, blockId: string, delta: string) {
  sendSSE(res, { type: 'block_delta', blockId, delta });
}

function sendBlockFull(res: http.ServerResponse, blockId: string, blockType: string, extra: Record<string, unknown> = {}) {
  sendSSE(res, { type: 'block_full', blockId, blockType, ...extra });
}

function sendMessageComplete(res: http.ServerResponse) {
  sendSSE(res, { type: 'message_complete' });
}

function readJsonBody<T = any>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {} as T);
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

// ── Clean env — strip session-leak vars ──

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v == null) continue;
    // Strip ALL Claude Desktop session context — these signal "you're inside a
    // Claude Desktop wrapper" and cause the spawned claude binary to auto-inject
    // --resume <parent-session-id>, creating session conflicts that deadlock.
    if (k === 'CLAUDE_CODE_SESSION_ID') continue;
    if (k === 'CLAUDE_CODE_RESUME') continue;
    if (k.startsWith('CLAUDE_CODE_')) continue;
    if (k.startsWith('CLAUDE_')) continue;
    if (k === 'CLAUDECODE') continue;
    if (k === 'AI_AGENT') continue;
    if (k === 'ANTHROPIC_BASE_URL') continue;
    if (k === 'ANTHROPIC_AUTH_TOKEN') continue;
    if (k === 'BAGGAGE') continue;
    if (k.startsWith('SENTRY_')) continue;
    if (k === '__CFBundleIdentifier') continue;
    if (k === 'NODE_OPTIONS') continue;
    if (k.startsWith('npm_')) continue;
    env[k] = v;
  }
  return env;
}

// Timeout helper
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── Claude Code (stream-json) ──

async function executeClaude(prompt: string, cwd: string, res: http.ServerResponse): Promise<void> {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
    '--disallowedTools', 'AskUserQuestion',
  ];

  const env = cleanEnv();
  const proc: ChildProcess = spawn('claude', args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });

  // Track for cleanup
  const cleanup = () => {
    try { proc.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 3000);
  };

  // When client disconnects, kill the child
  res.on('close', () => {
    cleanup();
  });

  const input = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: prompt }] },
  }) + '\n';
  proc.stdin!.write(input);
  proc.stdin!.end();

  const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });

  let stderr = '';
  proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

  let blockIdx = 0;
  const nextBlockId = () => `b${++blockIdx}`;
  let completed = false;

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        if (msg.type === 'stream_event') {
          const ev = msg.event;
          if (ev?.type === 'content_block_start') {
            const cb = ev.content_block;
            if (cb?.type === 'text') {
              sendBlockStart(res, nextBlockId(), 'text');
            } else if (cb?.type === 'tool_use') {
              sendBlockStart(res, nextBlockId(), 'tool_use', cb.name);
            }
          } else if (ev?.type === 'content_block_delta') {
            const delta = ev.delta;
            if (delta?.type === 'text_delta' && blockIdx > 0) {
              sendBlockDelta(res, `b${blockIdx}`, delta.text);
            } else if (delta?.type === 'input_json_delta' && blockIdx > 0) {
              sendBlockDelta(res, `b${blockIdx}`, delta.partial_json);
            }
          }
        } else if (msg.type === 'assistant') {
          for (const block of msg.message?.content || []) {
            if (block.type === 'thinking') {
              sendBlockFull(res, nextBlockId(), 'thinking', { content: block.thinking });
            }
          }
        } else if (msg.type === 'user') {
          for (const block of msg.message?.content || []) {
            if (block.type === 'tool_result') {
              sendBlockFull(res, nextBlockId(), 'tool_result', {
                toolName: block.tool_use_id,
                toolOutput: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
              });
            }
          }
        } else if (msg.type === 'result') {
          completed = true;
          sendMessageComplete(res);
          return;
        }
      } catch { /* skip malformed JSON */ }
    }
  } catch (e) {
    // for-await was interrupted (probably cleanup), fall through to finalize
  }

  // If we reach here (stdout closed without `result`), check exit code
  const exitCode = await new Promise<number | null>((resolve) => {
    proc.on('close', (code) => resolve(code));
    if (proc.exitCode !== null) resolve(proc.exitCode);
  });

  if (!completed) {
    if (exitCode !== 0 && exitCode !== null) {
      sendSSE(res, { type: 'error', error: stderr.trim() || `claude error (exit ${exitCode})` });
    } else {
      sendMessageComplete(res);
    }
  }
  cleanup();
}

// ── Codex CLI (exec) ──

async function executeCodex(prompt: string, cwd: string, res: http.ServerResponse): Promise<void> {
  const env = cleanEnv();
  const proc: ChildProcess = spawn('codex', ['exec', '--skip-git-repo-check'], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });

  const cleanup = () => {
    try { proc.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 3000);
  };

  res.on('close', () => {
    cleanup();
  });

  proc.stdin!.write(prompt);
  proc.stdin!.end();

  let stderr = '';
  proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
  let stdout = '';
  proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });

  const exitCode = await new Promise<number | null>((resolve) => {
    proc.on('close', (code) => resolve(code));
    if (proc.exitCode !== null) resolve(proc.exitCode);
  });

  if (stdout) {
    sendBlockStart(res, 'b1', 'text');
    sendBlockFull(res, 'b1', 'text', { content: stdout });
  }
  if (exitCode === 0) {
    sendMessageComplete(res);
  } else {
    sendSSE(res, { type: 'error', error: stderr || `codex error (exit ${exitCode})` });
  }
  cleanup();
}

// ── ACP (Hermes / Kimi / Kiro) ──

async function executeAcp(provider: string, prompt: string, cwd: string, res: http.ServerResponse): Promise<void> {
  const env = cleanEnv();
  const proc: ChildProcess = spawn(provider, ['acp'], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env,
  });

  const cleanup = () => {
    try { proc.kill('SIGTERM'); } catch {}
    setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 3000);
  };

  res.on('close', () => {
    cleanup();
  });

  let nextId = 1;
  proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'session/new', params: { cwd } }) + '\n');
  proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'session/prompt', params: { prompt } }) + '\n');

  const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.method === 'session/update' && msg.params) {
          const { delta } = msg.params;
          if (delta?.type === 'text') {
            sendBlockDelta(res, 'b1', delta.text);
          } else if (delta?.type === 'thinking') {
            sendBlockFull(res, 'b2', 'thinking', { content: delta.thinking });
          } else if (delta?.type === 'tool_call') {
            sendBlockFull(res, 'b3', 'tool_use', { toolName: delta.tool_name, toolInput: delta.input });
          }
        } else if (msg.method === 'session/complete') {
          sendMessageComplete(res);
          return;
        }
      } catch { /* skip */ }
    }
  } catch {
    // interrupted by cleanup
  }

  sendMessageComplete(res);
  cleanup();
}

// ── Router ──

const ROUTES: Record<string, (prompt: string, cwd: string, res: http.ServerResponse) => Promise<void>> = {
  claude: executeClaude,
  codex: executeCodex,
  opencode: executeCodex,
  hermes: (prompt, cwd, res) => executeAcp('hermes', prompt, cwd, res),
  kimi: (prompt, cwd, res) => executeAcp('kimi', prompt, cwd, res),
  kiro: (prompt, cwd, res) => executeAcp('kiro', prompt, cwd, res),
};

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/providers') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(scanProviders()));
    return;
  }

  if (req.method === 'POST' && req.url === '/llm-api/test') {
    try {
      const { config } = await readJsonBody(req);
      const result = await testLlmApi(config);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/llm-api/chat') {
    try {
      const { config, prompt, cwd, context } = await readJsonBody(req);
      const result = await chatWithLlmApi(config, prompt, cwd, context);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (e: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/llm-api/stream') {
    try {
      const { config, prompt, cwd, context } = await readJsonBody(req);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      await streamChatWithLlmApi(config, prompt, cwd || process.cwd(), context, event => sendSSE(res, event));
      if (!res.writableEnded) res.end();
    } catch (e: any) {
      if (!res.writableEnded) {
        sendSSE(res, { type: 'error', error: e?.message || String(e) });
        res.end();
      }
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/execute') {
    readJsonBody(req).then(async ({ provider = 'claude', prompt, cwd }) => {
      const executor = ROUTES[provider];

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      if (!executor) {
        sendSSE(res, { type: 'error', error: `Unknown provider: ${provider}` });
        res.end();
        return;
      }

      try {
        await executor(prompt, cwd || process.cwd(), res);
        if (!res.writableEnded) res.end();
      } catch (e: any) {
        if (!res.writableEnded) {
          sendSSE(res, { type: 'error', error: `Spawn failed: ${e.message || e}` });
          res.end();
        }
      }
    }).catch((e: any) => {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e?.message || String(e) }));
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`[Nexa Bridge] Listening on http://localhost:${PORT}`);
});
