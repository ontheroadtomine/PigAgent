# Nexa — 跨平台 AI 编程助手 架构方案

> 仿 Multica 方案：通过 CLI 工具的非交互式编程接口包装底层 Agent，前端使用 Electron + TypeScript 构建类 Cursor/Claude Code 体验。

---

## 1. 总体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Shell                        │
│  ┌──────────────────────┐  ┌──────────────────────────┐ │
│  │     Renderer Process  │  │     Main Process          │ │
│  │  (React + TypeScript) │  │  (Node.js + TypeScript)   │ │
│  │                       │  │                           │ │
│  │  ┌─────────────────┐  │  │  ┌─────────────────────┐  │ │
│  │  │ Monaco Editor   │  │  │  │ Agent Runtime       │  │ │
│  │  │ (代码编辑器)     │  │  │  │ (进程管理 + Adapter)│  │ │
│  │  ├─────────────────┤  │  │  ├─────────────────────┤  │ │
│  │  │ Chat Panel      │  │  │  │ File Watcher        │  │ │
│  │  │ (对话面板)       │  │  │  │ (文件变更追踪)      │  │ │
│  │  ├─────────────────┤  │  │  ├─────────────────────┤  │ │
│  │  │ Diff Viewer     │  │  │  │ Project Manager     │  │ │
│  │  │ (差异对比)       │  │  │  │ (项目管理)          │  │ │
│  │  ├─────────────────┤  │  │  ├─────────────────────┤  │ │
│  │  │ Agent Config    │  │  │  │ Session Manager     │  │ │
│  │  │ (Agent 配置)    │  │  │  │ (会话管理+持久化)   │  │ │
│  │  └─────────────────┘  │  │  └─────────────────────┘  │ │
│  │                       │  │                           │ │
│  │  IPC Bridge           │  │  IPC Bridge               │ │
│  │  (contextBridge)      │◄─┼─►(ipcMain)                │ │
│  └──────────────────────┘  └──────────┬────────────────┘ │
│                                       │                   │
└───────────────────────────────────────┼───────────────────┘
                                        │ exec / spawn
                                        ▼
                    ┌───────────────────────────────────────┐
                    │          CLI Agent 进程                │
                    │                                       │
                    │  claude   codex   copilot  opencode   │
                    │  hermes   cursor  kimi     pi  ...    │
                    │                                       │
                    │  统一通过 stdin/stdout JSON 协议通信    │
                    └───────────────────────────────────────┘
```

### 核心原则

**不需要 PTY**。所有现代 CLI Agent 工具都提供非交互式编程接口：
- Claude Code: `--output-format stream-json --input-format stream-json`
- Codex: `app-server --listen stdio://`(JSON-RPC 2.0)
- Hermes/Kimi/Kiro: `acp` 子命令 (ACP 协议，JSON-RPC 2.0)
- OpenCode: `run --json`
- Pi/Cursor: `--json` 模式
- 其他类似

Multica 已经用 Go 证明了这条路线，我们用 Node.js 做同样的事，而且更简单——`child_process.spawn` + `readline` 开箱即用。

---

## 2. 技术栈

| 层    | 选型                              | 原因                                                  |
| ----- | --------------------------------- | ----------------------------------------------------- |
| 壳    | Electron 28+                     | 原生 Node.js 进程管理，Monaco 开箱即用，PTY 备而不废  |
| 前端  | React 18 + TypeScript 5          | 生态成熟，组件丰富                                    |
| 编辑器 | Monaco Editor (`@monaco-editor/react`) | VS Code 同款内核，LSP 支持，diff 内置             |
| 构建  | electron-vite / electron-forge   | HMR 开发体验，打包一体化                              |
| 状态  | Zustand                          | 轻量，支持 subscribe selector，适合流式数据            |
| UI    | Tailwind CSS + shadcn/ui         | 快速出 UI，暗色模式内置                               |
| 进程  | Node.js `child_process`           | spawn + pipe，读 JSON 行                              |
| 文件  | chokidar                         | 跨平台文件监听，防抖内置                              |

---

## 3. 核心模块设计

### 3.1 Agent Runtime（主进程）

位置: `src/main/agent-runtime/`

```
src/main/agent-runtime/
├── runtime.ts          # AgentRuntime 主类，管理所有 provider 实例
├── provider-registry.ts # Provider 注册与发现（扫描 PATH）
├── types.ts            # 共享类型定义
├── adapters/           # 各 CLI 的 Backend 实现
│   ├── backend.ts      # Backend 接口定义
│   ├── claude.ts       # Claude Code
│   ├── codex.ts        # OpenAI Codex CLI
│   ├── copilot.ts      # GitHub Copilot CLI
│   ├── opencode.ts     # OpenCode
│   ├── hermes.ts       # Hermes (ACP 协议)
│   ├── cursor.ts       # Cursor Agent
│   ├── kimi.ts         # Kimi CLI
│   ├── pi.ts           # Pi CLI
│   └── ...
└── mcp.ts              # MCP 配置管理
```

#### Backend 接口

```typescript
// 对应 Multica 的 agent.Backend 接口
interface AgentBackend {
  readonly provider: string;
  readonly executablePath: string;

  execute(ctx: AbortContext, prompt: string, opts: ExecOptions): Session;
  detectVersion(): Promise<string>;
  listModels?(): Promise<Model[]>;
}

interface Session {
  readonly messages: AsyncIterable<AgentMessage>;
  readonly result: Promise<AgentResult>;
  abort(): void;
}

interface ExecOptions {
  cwd: string;
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
  timeout?: number;          // 硬超时
  inactivityTimeout?: number; // 语义不活跃超时
  resumeSessionId?: string;
  extraArgs?: string[];
  customArgs?: string[];
  mcpConfig?: object;
  thinkingLevel?: string;
}
```

#### Claude Code Adapter 示例

```typescript
// src/main/agent-runtime/adapters/claude.ts
// 对应 Multica 的 server/pkg/agent/claude.go

import { spawn } from 'child_process';
import { createInterface } from 'readline';

class ClaudeBackend implements AgentBackend {
  readonly provider = 'claude';

  constructor(readonly executablePath: string) {}

  execute(ctx: AbortContext, prompt: string, opts: ExecOptions): Session {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'bypassPermissions',
      '--disallowedTools', 'AskUserQuestion',
    ];
    if (opts.model)              args.push('--model', opts.model);
    if (opts.thinkingLevel)      args.push('--effort', opts.thinkingLevel);
    if (opts.maxTurns)           args.push('--max-turns', String(opts.maxTurns));
    if (opts.systemPrompt)       args.push('--append-system-prompt', opts.systemPrompt);
    if (opts.resumeSessionId)    args.push('--resume', opts.resumeSessionId);

    const proc = spawn(this.executablePath, args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: ctx.signal,
    });

    // stdin: 发送 JSON 行
    const input = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: prompt }] },
    }) + '\n';
    proc.stdin.write(input);

    // stdout: 逐行解析 JSON 事件
    const rl = createInterface({ input: proc.stdout });
    const messageIterator = this.parseStream(rl, proc);

    // 带 inactivity timeout 的结果封装
    const result = this.waitForResult(proc, messageIterator, opts);

    return { messages: messageIterator, result, abort: () => proc.kill() };
  }

  private async *parseStream(rl: ReadLineInterface, proc: ChildProcess) {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      switch (msg.type) {
        case 'assistant':
          // 解析 content block: text / thinking / tool_use
          yield* this.handleAssistant(msg);
          break;
        case 'user':
          yield* this.handleUser(msg);  // tool_result
          break;
        case 'system':
          yield { type: 'status', status: 'running', sessionId: msg.session_id };
          break;
        case 'result':
          // 最终结果，退出循环
          return;
        case 'control_request':
          this.autoApprove(proc, msg);
          break;
      }
    }
  }

  // control_request 自动批准（对应 Multica 的 handleControlRequest）
  private autoApprove(proc: ChildProcess, msg: ControlRequest) {
    const response = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: msg.request_id,
        response: { behavior: 'allow', updatedInput: msg.input },
      },
    };
    proc.stdin.write(JSON.stringify(response) + '\n');
  }
}
```

#### ACP 协议 Adapter（Hermes / Kimi / Kiro 通用）

```typescript
// ACP = Agent Communication Protocol, JSON-RPC 2.0 over stdin/stdout
// 对应 Multica 的 hermes.go / kimi.go / kiro.go

class AcpBackend implements AgentBackend {
  private nextId = 1;

  execute(ctx: AbortContext, prompt: string, opts: ExecOptions): Session {
    const proc = spawn(this.executablePath, ['acp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: ctx.signal,
    });

    // 1. 发送 session/new 初始化
    this.sendRpc(proc, 'session/new', {
      cwd: opts.cwd,
      mcpServers: this.buildMcpServers(opts.mcpConfig),
    });

    // 2. 发送 session/prompt 执行任务
    this.sendRpc(proc, 'session/prompt', { prompt });

    // 3. 读取 JSON-RPC 响应/通知流
    // ...
  }

  private sendRpc(proc: ChildProcess, method: string, params: object) {
    const msg = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method,
      params,
    };
    proc.stdin.write(JSON.stringify(msg) + '\n');
  }
}
```

### 3.2 Provider 注册与发现

```typescript
// src/main/agent-runtime/provider-registry.ts
// 对应 Multica 的 daemon CLI 自动检测

interface ProviderInfo {
  name: string;           // 'claude' | 'codex' | 'copilot' | ...
  executablePath: string; // 绝对路径
  version: string;        // 版本号
  available: boolean;     // PATH 可解析
}

const KNOWN_PROVIDERS: ProviderConfig[] = [
  { name: 'claude',   exe: 'claude',       versionFlag: '--version', backend: ClaudeBackend },
  { name: 'codex',    exe: 'codex',        versionFlag: '--version', backend: CodexBackend },
  { name: 'copilot',  exe: 'copilot',      versionFlag: '--version', backend: CopilotBackend },
  { name: 'opencode', exe: 'opencode',     versionFlag: '--version', backend: OpenCodeBackend },
  { name: 'hermes',   exe: 'hermes',       versionFlag: '--version', backend: HermesBackend },
  { name: 'cursor',   exe: 'cursor-agent', versionFlag: '--version', backend: CursorBackend },
  { name: 'kimi',     exe: 'kimi',         versionFlag: '--version', backend: KimiBackend },
  { name: 'pi',       exe: 'pi',           versionFlag: '--version', backend: PiBackend },
  // ... 更多
];

async function detectProviders(): Promise<ProviderInfo[]> {
  const results: ProviderInfo[] = [];
  for (const cfg of KNOWN_PROVIDERS) {
    const resolved = await which(cfg.exe).catch(() => null);
    if (resolved) {
      const version = await detectVersion(resolved, cfg.versionFlag);
      results.push({ ...cfg, executablePath: resolved, version, available: true });
    }
  }
  return results;
}
```

### 3.3 执行环境管理（execenv）

对应 Multica 的 `server/internal/daemon/execenv/`——为每个任务创建隔离的工作目录：

```typescript
// src/main/agent-runtime/execenv.ts

interface ExecEnv {
  rootDir: string;     // ~/nexa/workspaces/{wsId}/{taskShortId}/
  workDir: string;     // envRoot/workdir/ 或用户指定的本地目录
  outputDir: string;   // envRoot/output/
  logsDir: string;     // envRoot/logs/
}

interface PrepareParams {
  workspacesRoot: string;
  workspaceId: string;
  taskId: string;
  provider: string;
  task: TaskContext;     // issue 标题、描述、skills 等
  localWorkDir?: string; // 可选：直接操作用户目录
}

async function prepareEnv(params: PrepareParams): Promise<ExecEnv> {
  const envRoot = path.join(params.workspacesRoot, params.workspaceId, shortId(params.taskId));

  await fs.mkdir(path.join(envRoot, 'workdir'), { recursive: true });
  await fs.mkdir(path.join(envRoot, 'output'), { recursive: true });
  await fs.mkdir(path.join(envRoot, 'logs'), { recursive: true });

  // 写入上下文文件
  await writeContextFiles(envRoot, params.task);

  return { rootDir: envRoot, workDir: path.join(envRoot, 'workdir'), ... };
}

// 写入 agent 需要感知的上下文
async function writeContextFiles(workDir: string, task: TaskContext) {
  // issue_context.md — 任务描述、项目信息
  await fs.writeFile(path.join(workDir, 'issue_context.md'), renderIssueContext(task));
  // skills/ — workspace skills
  for (const skill of task.skills) {
    await fs.writeFile(path.join(workDir, 'skills', skill.name, 'SKILL.md'), skill.content);
  }
  // resources.json — 项目资源（repo URL 等）
  await fs.writeFile(path.join(workDir, 'resources.json'), JSON.stringify(task.resources));
}
```

### 3.4 Session Manager

```typescript
// src/main/session-manager.ts

interface SessionRecord {
  id: string;
  taskId: string;
  provider: string;
  providerSessionId?: string;  // 用于 --resume
  status: 'running' | 'completed' | 'failed' | 'aborted';
  workDir: string;
  messages: AgentMessage[];
  usage: TokenUsage;
  startedAt: Date;
  completedAt?: Date;
}

class SessionManager {
  // 持久化到本地 SQLite（better-sqlite3）
  private db: Database;

  // 支持 resume: 传入上次的 providerSessionId
  async resumeSession(sessionId: string, provider: string, workDir: string): Promise<Session>;
  // 历史记录
  async listSessions(taskId: string): Promise<SessionRecord[]>;
  // 流式写入消息
  async appendMessage(sessionId: string, msg: AgentMessage): Promise<void>;
}
```

---

## 4. 前端设计（Renderer Process）

### 4.1 布局

```
┌──────────────────────────────────────────────────────────┐
│  Menu Bar (文件 / 编辑 / 视图 / Agent / 帮助)              │
├──────────┬───────────────────────────────┬───────────────┤
│          │                               │               │
│  File    │                               │  Chat Panel   │
│  Tree    │     Monaco Editor             │               │
│          │                               │  ┌─────────┐  │
│  ├── src │     (代码编辑区)               │  │ Messages│  │
│  │  ├─x  │                               │  │         │  │
│  │  ├─y  │                               │  │ [Agent] │  │
│  │  └─z  │                               │  │ 正在... │  │
│          │                               │  │         │  │
│          │                               │  ├─────────┤  │
│          │                               │  │ Input   │  │
│          │                               │  └─────────┘  │
├──────────┴───────────────────────────────┴───────────────┤
│  Status Bar (Provider | Model | Tokens | Cursor Position) │
└──────────────────────────────────────────────────────────┘
```

### 4.2 组件树

```
<App>
  <MainLayout>
    <Sidebar>
      <FileTree />           # 文件浏览器
      <AgentList />          # 可用 Agent 列表
    </Sidebar>
    <EditorArea>
      <MonacoEditor />       # 代码编辑
      <DiffViewer />         # Agent 变更对比（条件渲染）
    </EditorArea>
    <ChatPanel>
      <MessageList>          # 对话历史
        <UserMessage />
        <AgentMessage>       # 支持流式渲染
          <ThinkingBlock />  # 思考过程
          <ToolUseBlock />   # 工具调用
          <CodeBlock />      # 代码块 + Apply 按钮
        </AgentMessage>
      </MessageList>
      <ChatInput />          # 输入框 + @provider 选择
    </ChatPanel>
    <StatusBar>
      <ProviderIndicator />
      <ModelSelector />
      <TokenCounter />
    </StatusBar>
  </MainLayout>
</App>
```

### 4.3 IPC 通信设计

```typescript
// src/shared/ipc-channels.ts

// Renderer → Main
const IPC = {
  AGENT_EXECUTE:    'agent:execute',     // 发起 agent 任务
  AGENT_ABORT:      'agent:abort',       // 中止任务
  AGENT_LIST:       'agent:list',        // 获取可用 provider
  AGENT_MODELS:     'agent:models',      // 获取模型列表
  FILE_READ:        'file:read',         // 读文件
  FILE_WRITE:       'file:write',        // 写文件（agent 产出的 diff）
  FILE_WATCH:       'file:watch',        // 开始监听目录
  SESSION_RESUME:   'session:resume',    // 恢复会话
  SESSION_HISTORY:  'session:history',   // 历史记录
} as const;

// Main → Renderer（推送）
const IPC_EVENTS = {
  AGENT_MESSAGE:    'agent:message',      // 流式消息推送
  AGENT_RESULT:     'agent:result',       // 任务结束
  FILE_CHANGED:     'file:changed',       // 文件变更通知
} as const;
```

---

## 5. 数据流

### 5.1 一次完整的 Agent 调用

```
用户在 Chat 输入 "重构 src/utils.ts，拆分成更小的函数"
        │
        ▼
┌─ Renderer ──────────────────────────────────────────┐
│ 1. ChatInput 提交                                    │
│ 2. 通过 ipcRenderer.invoke('agent:execute', {        │
│      provider: 'claude',                             │
│      prompt: '重构 src/utils.ts ...',                │
│      workDir: '/Users/xxx/my-project',               │
│      files: ['src/utils.ts'],                        │
│    })                                                │
└──────────────────┬──────────────────────────────────┘
                   │ IPC
                   ▼
┌─ Main Process ──────────────────────────────────────┐
│ 3. AgentRuntime.execute()                            │
│    ├─ prepareEnv({ workDir: '...' })                 │
│    │  └─ 写入 issue_context.md, resources.json       │
│    ├─ backend = new ClaudeBackend(execPath)          │
│    ├─ session = backend.execute(ctx, prompt, opts)   │
│    │  └─ spawn('claude', ['-p', '--output-format',   │
│    │       'stream-json', ...])                      │
│    └─ for await (msg of session.messages) {          │
│         mainWindow.webContents.send(                 │
│           'agent:message', msg)                      │
│       }                                              │
└──────────────────┬──────────────────────────────────┘
                   │ IPC (webContents.send)
                   ▼
┌─ Renderer ──────────────────────────────────────────┐
│ 4. ChatPanel 收到 'agent:message'                    │
│    ├─ MessageList 增量渲染 thinking/text/tool_use    │
│    ├─ FileTree 收到 'file:changed' → 刷新            │
│    └─ DiffViewer 自动弹出变更文件                     │
│                                                       │
│ 5. 收到 'agent:result' → 显示完成状态 + token 用量    │
└──────────────────────────────────────────────────────┘
```

### 5.2 Agent 修改文件后的 Diff 流程

```
Agent 写文件
    │
    ▼
┌─ Main Process ──────────────────────────────────────┐
│ chokidar 监听到 workDir/src/utils.ts 变更             │
│    │                                                  │
│    ├─ 对比 git diff (或与上次快照 diff)                │
│    ├─ mainWindow.webContents.send(                   │
│    │    'file:changed', { path, diff, status })      │
│    └─ 发送 'agent:message' {                         │
│          type: 'tool-result',                        │
│          output: 'Wrote src/utils.ts'                │
│        }                                             │
└──────────────────┬──────────────────────────────────┘
                   ▼
┌─ Renderer ──────────────────────────────────────────┐
│ DiffViewer 自动打开 src/utils.ts                     │
│ Monaco 左侧: 原始内容，右侧: Agent 写入的内容         │
│ 用户可逐行 Accept / Reject 变更                      │
└──────────────────────────────────────────────────────┘
```

---

## 6. 项目目录结构

```
Nexa/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
│
├── src/
│   ├── main/                          # Electron Main Process
│   │   ├── index.ts                   # 入口：窗口管理、IPC 注册
│   │   ├── agent-runtime/
│   │   │   ├── runtime.ts             # AgentRuntime 主类
│   │   │   ├── provider-registry.ts   # Provider 扫描与注册
│   │   │   ├── execenv.ts             # 执行环境准备
│   │   │   ├── mcp.ts                 # MCP 配置
│   │   │   ├── types.ts               # 类型
│   │   │   └── adapters/
│   │   │       ├── backend.ts         # Backend 接口
│   │   │       ├── claude.ts          # Claude Code
│   │   │       ├── codex.ts           # Codex
│   │   │       ├── copilot.ts         # GitHub Copilot
│   │   │       ├── opencode.ts        # OpenCode
│   │   │       ├── hermes.ts          # Hermes (ACP)
│   │   │       ├── cursor.ts          # Cursor Agent
│   │   │       ├── kimi.ts            # Kimi (ACP)
│   │   │       ├── kiro.ts            # Kiro (ACP)
│   │   │       ├── pi.ts              # Pi
│   │   │       └── acp.ts             # ACP 协议通用基类
│   │   ├── file-watcher.ts            # chokidar 封装
│   │   ├── session-manager.ts         # 会话持久化
│   │   ├── git-helper.ts              # git diff / 快照
│   │   └── ipc-handlers.ts            # IPC handler 注册
│   │
│   ├── renderer/                      # Electron Renderer Process
│   │   ├── index.html
│   │   ├── App.tsx
│   │   ├── main.tsx                   # React 入口
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── MainLayout.tsx
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   └── StatusBar.tsx
│   │   │   ├── editor/
│   │   │   │   ├── MonacoEditor.tsx
│   │   │   │   └── DiffViewer.tsx
│   │   │   ├── chat/
│   │   │   │   ├── ChatPanel.tsx
│   │   │   │   ├── MessageList.tsx
│   │   │   │   ├── MessageBubble.tsx
│   │   │   │   ├── ThinkingBlock.tsx
│   │   │   │   ├── ToolUseBlock.tsx
│   │   │   │   └── ChatInput.tsx
│   │   │   ├── files/
│   │   │   │   └── FileTree.tsx
│   │   │   └── agents/
│   │   │       ├── AgentList.tsx
│   │   │       └── AgentConfig.tsx
│   │   ├── stores/
│   │   │   ├── chat-store.ts          # 对话状态
│   │   │   ├── editor-store.ts        # 编辑器状态
│   │   │   ├── agent-store.ts         # Agent 状态
│   │   │   └── file-store.ts          # 文件树+变更追踪
│   │   ├── hooks/
│   │   │   ├── useAgentExecute.ts     # 调用 agent:execute IPC
│   │   │   ├── useAgentStream.ts      # 监听 agent:message 流
│   │   │   └── useFileWatch.ts        # 监听 file:changed
│   │   └── lib/
│   │       └── ipc.ts                 # IPC 调用封装
│   │
│   └── shared/                        # Main ↔ Renderer 共享
│       ├── ipc-channels.ts            # IPC channel 常量
│       └── types.ts                   # 共享类型定义
│
├── resources/                         # 图标等静态资源
└── scripts/                           # 构建/签名脚本
```

---

## 7. 开发路线图

### Phase 1: MVP（2-4 周）

- [x] Electron + React 骨架搭建
- [ ] Monaco Editor 集成（基础编辑 + 代码高亮）
- [ ] 单个 Agent Adapter（Claude Code，含 stream-json 解析 + control_request 自动批准）
- [ ] Chat Panel（消息渲染 + 流式增量显示）
- [ ] 基本 IPC 通信（execute / abort / result）
- [ ] 文件树组件

### Phase 2: 多 Agent 支持（2 周）

- [ ] Provider 注册表 + 自动发现
- [ ] Codex Adapter（app-server + JSON-RPC）
- [ ] ACP 协议通用基类 + Hermes Adapter
- [ ] Agent 选择器 UI（@provider 切换）

### Phase 3: Diff & 编辑器增强（2 周）

- [ ] Diff Viewer（Agent 变更前后对比）
- [ ] 文件变更追踪（chokidar + git diff）
- [ ] Inline Accept/Reject（逐行确认 Agent 的修改）
- [ ] Monaco LSP 集成提示

### Phase 4: 会话 & 高阶功能（2 周）

- [ ] Session Manager（SQLite 持久化）
- [ ] 会话 Resume（--resume 复用历史上下文）
- [ ] MCP 配置 UI
- [ ] 多项目 Workspace 管理
- [ ] Token 用量统计

### Phase 5: 补齐 & 打磨（持续）

- [ ] 更多 Adapter（Kimi, Kiro, Pi, Cursor, Qoder 等）
- [ ] Electron 打包 + 自动更新
- [ ] 跨平台测试（macOS / Windows / Linux）
- [ ] 暗色/亮色主题
- [ ] 快捷键系统

---

## 8. 关键设计决策

### 8.1 为什么不用 PTY

| PTY 方案            | 非交互式 JSON 方案（Multica 方案）  |
| ------------------- | ----------------------------------- |
| 需要处理终端控制序列  | 不需要                               |
| 需要 JS 端 PTY 绑定  | Node.js `child_process.spawn` 原生  |
| 每个 CLI 不同解析逻辑 | 每个 CLI 仍是不同协议，但是结构化的 JSON |
| 稳定但复杂          | 简单且够用                           |

**所有目标 CLI 都提供了非交互模式**。用户正常在终端交互使用这些 CLI 时走 PTY 是合理的；但在自动化场景中，每个 CLI 都有意提供了编程接口。

### 8.2 为什么不直接用 Multica

Multica 是 Web 应用（Next.js + Go），缺少内置代码编辑器。它的定位是"团队 issue 面板 + agent 调度系统"。我们要做的是"个人 AI 编程环境"，两者互补但场景不同。

### 8.3 Electron vs Tauri 的最终选择

Tauri 轻量但在进程管理上需要 Rust → JS 桥接，子进程 stdin/stdout 管道读写要序列化穿过两层。Electron 的 Node.js 侧直接 `spawn` + `readline`，和 CLI agent 的 JSON 行协议是天然匹配——TypeScript 写 adapter 层就是几十行 pipe 代码，不需要 Rust。

---

## 9. 参考

- [Multica 源码](https://github.com/multica-ai/multica) — agent adapter 模式、execenv 设计、daemon 架构
- [Claude Code stream-json 协议](https://code.claude.com/docs/en/claude-code-stream-json) — Claude Code 编程接口文档
- [ACP 协议](https://agentcommunicationprotocol.dev/) — Hermes/Kimi/Kiro 使用的 JSON-RPC 2.0 协议
- [Codex CLI app-server](https://github.com/openai/codex-cli) — Codex 的非交互模式
