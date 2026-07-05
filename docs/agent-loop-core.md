# PigAgent Agent Loop 核心实现文档

> 版本: 2.0  
> 最后更新: 2025-07-04  
> 核心文件: `src/main/agent-core/loop.ts`, `src/main/agent-core/types.ts`, `src/main/agent-core/tool-registry.ts`, `src/main/agent-core/default-tools.ts`

---

## 1. 架构总览

PigAgent 的 Agent Loop 是一个 **ReAct (Reasoning + Acting)** 模式的迭代执行引擎。它让 LLM 在每一轮中推理、调用工具、观察结果，直到任务完成。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PigAgent 整体架构                                    │
│                                                                             │
│  ┌──────────┐    ┌──────────────────┐    ┌──────────────────────────────┐   │
│  │ Renderer │◄──►│   IPC / Bridge   │◄──►│        Agent Loop            │   │
│  │ (React)  │    │                  │    │                              │   │
│  │          │    │ ipc-handlers.ts  │    │  ┌────────────────────────┐  │   │
│  │ Zustand  │    │ dev-bridge.ts    │    │  │   AgentLoop (loop.ts)  │  │   │
│  │ Store    │    │ llm-api.ts       │    │  │                        │  │   │
│  └──────────┘    └──────────────────┘    │  │  ┌──────────────────┐  │  │   │
│                                           │  │  │  ToolRegistry   │  │  │   │
│                                           │  │  │  ┌────────────┐ │  │  │   │
│                                           │  │  │  │ workspace │ │  │  │   │
│                                           │  │  │  │ shell     │ │  │  │   │
│                                           │  │  │  │ web_fetch │ │  │  │   │
│                                           │  │  │  │ weather   │ │  │  │   │
│                                           │  │  │  │ patch     │ │  │  │   │
│                                           │  │  │  └────────────┘ │  │  │   │
│                                           │  │  └──────────────────┘  │  │   │
│                                           │  └────────────────────────┘  │   │
│                                           └──────────────────────────────┘   │
│                                                    │                         │
│                                                    ▼                         │
│                                           ┌──────────────────────────────┐   │
│                                           │     LLM API (OpenAI兼容)      │   │
│                                           │  POST /v1/chat/completions    │   │
│                                           │  stream: true, tool_choice:   │   │
│                                           │  auto                         │   │
│                                           └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 核心数据结构

### 2.1 消息类型 (`ChatMessageWire`)

```typescript
type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

interface ChatMessageWire {
  role: ChatRole;
  content?: string | null;
  tool_call_id?: string;       // 用于 tool 角色的消息，关联到具体的 tool_call
  tool_calls?: ToolCallWire[]; // assistant 消息中的工具调用列表
}
```

### 2.2 工具调用 (`ToolCallWire`)

```typescript
interface ToolCallWire {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON 字符串，需要 parseArgs() 解析
  };
}
```

### 2.3 Agent Loop 选项 (`AgentLoopOptions`)

```typescript
interface AgentLoopOptions {
  config: LlmApiConfig;           // LLM API 配置（baseUrl, model 等）
  apiKey: string;                 // API 密钥
  prompt: string;                 // 用户输入的提示词
  cwd: string;                    // 工作目录
  signal?: AbortSignal;           // 取消信号（父级）
  maxTurns?: number;              // 最大轮次（默认 20）
  onEvent?: (event: AgentLoopEvent) => void;  // 事件回调
}
```

### 2.4 事件类型 (`AgentLoopEvent`)

```typescript
type AgentLoopEvent =
  | { type: 'status'; status: 'thinking' | 'executing' | 'post_tool' | 'streaming'; message?: string }
  | { type: 'tool_start'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; output: string }
  | { type: 'text_start' }
  | { type: 'text_delta'; delta: string };
```

### 2.5 工具接口 (`AgentTool`)

```typescript
interface AgentTool {
  name: string;
  schema: AgentToolSchema;  // OpenAI function calling schema
  run(args: Record<string, unknown>, context: AgentToolContext): Promise<unknown>;
}

interface AgentToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;  // JSON Schema
  };
}

interface AgentToolContext {
  cwd: string;
}

interface AgentToolResult {
  ok: boolean;
  result?: unknown;   // 成功时的数据
  error?: string;     // 失败时的错误信息
}
```

---

## 3. Agent Loop 主流程 (`loop.ts`)

### 3.1 完整流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Agent Loop 主流程                                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  run(options) 入口                                                   │    │
│  │  - 构建 system prompt（PigAgent 身份 + 工具使用指南）                  │    │
│  │  - 将 user prompt 加入 messages                                      │    │
│  │  - 初始化 toolCallsLog = []                                          │    │
│  └──────────────────────┬──────────────────────────────────────────────┘    │
│                         │                                                  │
│                         ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  for turn = 0; turn < maxTurns (20); turn++                         │    │
│  │  ┌───────────────────────────────────────────────────────────────┐  │    │
│  │  │ ① 发送 status 事件                                             │  │    │
│  │  │   turn===0 → 'thinking' / 否则 → 'streaming'                   │  │    │
│  │  │                                                               │  │    │
│  │  │ ② 创建 Round Signal                                            │  │    │
│  │  │   - 90s 超时定时器                                             │  │    │
│  │  │   - 绑定父级 AbortSignal                                       │  │    │
│  │  │   - 返回 { signal, cleanup }                                   │  │    │
│  │  │                                                               │  │    │
│  │  │ ③ requestChatCompletionStream()                               │  │    │
│  │  │   ├── POST {baseUrl}/v1/chat/completions                       │  │    │
│  │  │   ├── body: { messages, tools, tool_choice: 'auto',            │  │    │
│  │  │   │         temperature: 0.2, stream: true }                   │  │    │
│  │  │   ├── SSE 流解析:                                              │  │    │
│  │  │   │   ├── delta.content → onText() → text_delta 事件           │  │    │
│  │  │   │   └── delta.tool_calls → toolCallMap[index] 累积           │  │    │
│  │  │   └── 返回 { content, toolCalls }                              │  │    │
│  │  │                                                               │  │    │
│  │  │ ④ 检查 toolCalls.length === 0 ?                               │  │    │
│  │  │   ├── YES → 返回 { content, turns, toolCallsLog } ✅           │  │    │
│  │  │   └── NO  → 继续                                              │  │    │
│  │  │                                                               │  │    │
│  │  │ ⑤ 将 assistant message (含 tool_calls) 加入 messages           │  │    │
│  │  │                                                               │  │    │
│  │  │ ⑥ 遍历每个 tool_call:                                         │  │    │
│  │  │   ├── parseArgs() → JSON.parse(arguments)                      │  │    │
│  │  │   ├── 发送 tool_start 事件                                     │  │    │
│  │  │   ├── 发送 status: 'executing' 事件                            │  │    │
│  │  │   ├── tools.execute(name, args, { cwd })                       │  │    │
│  │  │   ├── 记录 toolCallsLog.push({ name, args, ok, output })       │  │    │
│  │  │   ├── 发送 tool_result 事件                                    │  │    │
│  │  │   ├── 发送 status: 'post_tool' 事件                            │  │    │
│  │  │   └── 将 tool role message 加入 messages                       │  │    │
│  │  └──────────────────────┬────────────────────────────────────────┘  │    │
│  │                         │                                            │    │
│  │                         ▼                                            │    │
│  │  ┌───────────────────────────────────────────────────────────────┐  │    │
│  │  │ ⑦ 回到循环顶部 → 下一轮 (turn++)                               │  │    │
│  │  └───────────────────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 超时处理:                                                           │    │
│  │  - 如果模型单轮超时 (90s) 且已有成功的工具调用                         │    │
│  │    → buildFallbackSummary() 生成结构化 fallback 总结并返回            │    │
│  │  - 否则抛出 ModelRoundTimeoutError                                   │    │
│  │                                                                     │    │
│  │ 达到最大轮次:                                                        │    │
│  │  - 抛出 Error("Agent loop reached max turns (N).")                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 详细步骤说明

#### 步骤 1: 初始化

```typescript
const messages: ChatMessageWire[] = [
  { role: 'system', content: buildSystemPrompt() },
  { role: 'user', content: options.prompt },
];
```

`buildSystemPrompt()` 构建的 system prompt 包含：
- PigAgent 身份声明（"You are PigAgent, a Codex-style desktop software agent."）
- 工具使用指南（先看再改、批量读取、聚焦命令、不暴露密钥）
- 工具列表说明（weather_current, web_fetch, workspace_files 等）

#### 步骤 2: 请求 LLM (流式)

`requestChatCompletionStream()` 的核心逻辑：

1. **构建 URL**: 自动拼接 `{baseUrl}/v1/chat/completions`
2. **发送请求**: POST 请求，`stream: true`
3. **SSE 解析**: 逐行读取 `data: {...}` 事件
   - `delta.content` → 实时通过 `onText()` 回调发送 `text_delta` 事件
   - `delta.tool_calls` → 按 `index` 累积到 `toolCallMap`，处理分块传输
4. **返回**: `{ content: string, toolCalls: ToolCallWire[] }`

#### 步骤 3: 判断是否完成

```typescript
if (toolCalls.length === 0) {
  const content = message?.content?.trim() || '';
  return { content, turns: turn + 1, toolCalls: toolCallsLog };
}
```

- 模型返回纯文本（无工具调用）→ 任务完成
- 模型返回工具调用 → 进入工具执行阶段

#### 步骤 4: 执行工具

```typescript
for (const call of toolCalls) {
  const args = parseArgs(call.function.arguments);
  options.onEvent?.({ type: 'tool_start', name: call.function.name, args });
  options.onEvent?.({ type: 'status', status: 'executing', message: `执行 ${call.function.name}` });
  const result = await this.tools.execute(call.function.name, args, { cwd: options.cwd });
  const output = JSON.stringify(result);
  toolCallsLog.push({ name: call.function.name, args, ok: result.ok, output });
  options.onEvent?.({ type: 'tool_result', name: call.function.name, ok: result.ok, output });
  options.onEvent?.({ type: 'status', status: 'post_tool', message: '工具执行完成，正在整理最终回复' });
  messages.push({
    role: 'tool',
    tool_call_id: call.id,
    content: JSON.stringify(result),
  });
}
```

#### 步骤 5: 下一轮

工具结果作为 `tool` 角色消息加入对话历史，LLM 在下一轮看到结果后继续推理。

### 3.3 超时与错误处理

| 场景 | 处理方式 |
|------|----------|
| **单轮超时 (90s)** | 如果已有成功的工具调用 → 生成 fallback 总结并返回；否则抛出异常 |
| **父级 AbortSignal 触发** | 立即中止当前轮次 |
| **HTTP 错误** | 抛出包含状态码和错误详情的异常 |
| **达到最大轮次 (20)** | 抛出 Error |

### 3.4 Fallback 总结机制

当模型在工具执行后超时（无法生成最终总结），系统自动构建一个结构化的 fallback 消息：

```typescript
function buildFallbackSummary(toolCalls): string {
  const successful = toolCalls.filter(call => call.ok);
  if (!successful.length) return '模型本轮响应超时，且没有可确认完成的工具结果。请重试。';
  
  // 构建格式：
  // 模型最终总结响应超时，但以下工具操作已经完成：
  //
  // - workspace_files
  // - file_read_many：src/main/agent-core/loop.ts
  // - shell_exec
  //
  // 你可以根据上面的工具结果继续操作，或重新发送"总结刚才的结果"。
}
```

### 3.5 Round Signal 机制

```typescript
function createRoundSignal(parentSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ModelRoundTimeoutError()), 90_000);
  // 绑定父级 AbortSignal
  // 自动清理定时器和事件监听
  return { signal: controller.signal, cleanup };
}
```

每轮请求独立创建 Round Signal，确保：
- 单轮超时不影响其他轮次
- 父级取消信号可以传播到当前轮次
- 请求完成后自动清理资源

---

## 4. 工具注册与执行 (`tool-registry.ts`)

### 4.1 ToolRegistry 类

```typescript
class ToolRegistry {
  private tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool);
  }

  schemas(): AgentToolSchema[] {
    return Array.from(this.tools.values()).map(tool => tool.schema);
  }

  async execute(name: string, args: Record<string, unknown>, context: AgentToolContext): Promise<AgentToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
    try {
      const result = await tool.run(args, context);
      return { ok: true, result };
    } catch (error: any) {
      return { ok: false, error: error?.message || String(error) };
    }
  }
}
```

### 4.2 默认工具列表 (`default-tools.ts`)

| 工具名 | 描述 | 源文件 | 参数 |
|--------|------|--------|------|
| `weather_current` | 获取实时天气（Open-Meteo API） | `tools/weather.ts` | `location` (必填) |
| `workspace_list` | 列出工作区目录 | `tools/workspace.ts` | `path` (可选) |
| `workspace_files` | 列出工作区文件（排除依赖） | `tools/workspace.ts` | `limit` (可选, 默认300) |
| `workspace_search` | 使用 ripgrep 搜索文本 | `tools/workspace.ts` | `pattern` (必填), `path`, `limit` |
| `file_read` | 读取单个文件（截断至60KB） | `tools/workspace.ts` | `path` (必填) |
| `file_read_many` | 批量读取多个文件（最多20个，总80KB） | `tools/workspace.ts` | `paths` (必填, 数组) |
| `file_write` | 创建/覆盖文件 | `tools/workspace.ts` | `path` (必填), `content` (必填) |
| `shell_exec` | 执行 shell 命令 | `tools/shell.ts` | `command` (必填), `timeoutMs` |
| `web_fetch` | 获取 HTTP URL 内容（截断至50KB） | `tools/web.ts` | `url` (必填) |
| `apply_patch` | 应用 unified diff patch | `tools/patch.ts` | `patch` (必填) |

### 4.3 工具执行结果格式

```typescript
interface AgentToolResult {
  ok: boolean;
  result?: unknown;   // 成功时的数据
  error?: string;     // 失败时的错误信息
}
```

---

## 5. 流式 SSE 解析 (`requestChatCompletionStream`)

### 5.1 SSE 解析流程

```
LLM API Response (SSE stream)
│
├── data: {"choices":[{"delta":{"content":"我来分析"}}]}
│   → onText("我来分析") → text_delta 事件
│
├── data: {"choices":[{"delta":{"content":"这个任务"}}]}
│   → onText("这个任务") → text_delta 事件
│
├── data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"workspace_files","arguments":"{\"limit\":300}"}}]}}]}
│   → toolCallMap[0] = { id: "call_1", function: { name: "workspace_files", arguments: '{"limit":300}' } }
│
├── data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}
│   → toolCallMap[0].function.arguments += "}"
│
├── data: [DONE]
│   → 流结束
│
└── 返回 { content: "完整文本", toolCalls: [排序后的工具调用列表] }
```

### 5.2 关键实现细节

```typescript
// 按 index 排序去重
Array.from(toolCallMap.entries())
  .sort(([a], [b]) => a - b)
  .map(([, call]) => call)
  .filter(call => call.function.name)  // 过滤掉没有函数名的空调用
```

- 使用 `Map<number, ToolCallWire>` 按 index 存储
- 支持分块传输的 tool_calls（arguments 可能分多次到达）
- 自动处理 `[DONE]` 结束标记
- 缓冲区处理跨 chunk 的 SSE 事件边界

---

## 6. 调用链路

### 6.1 通过 IPC (Electron 模式)

```
Renderer (app-store.ts)
  → window.pigagent.chatLlmApi(config, prompt, cwd)
    → ipcMain.handle(IPC.LLM_API_CHAT)
      → chatWithLlmApi() [llm-api.ts]
        → resolveApiKey() 解析 API 密钥
        → new AgentLoop(createDefaultToolRegistry())
          → loop.run({ config, apiKey, prompt, cwd, signal, onEvent })
            → 多轮循环...
        → 返回 LlmApiChatResult { ok, content, toolCalls, latencyMs }
```

### 6.2 通过 Bridge (浏览器开发模式)

```
Renderer (app-store.ts)
  → fetch(`${BRIDGE_URL}/llm-api/stream`, { body: { config, prompt, cwd } })
    → streamChatWithLlmApi() [llm-api.ts]
      → resolveApiKey() 解析 API 密钥
      → new AgentLoop(createDefaultToolRegistry())
        → loop.run({ config, apiKey, prompt, cwd, signal, onEvent })
          → onEvent(event) → emit(event) → SSE data → Renderer
```

### 6.3 流式事件传递

```
AgentLoop.onEvent(event)
  → streamChatWithLlmApi emit(event)
    → SSE data: { type: 'status', status: 'thinking' }
      → Renderer SSE 解析
        → updateAssistantFromLlmEvent(assistantId, event)
          → Zustand store set() → React re-render
```

### 6.4 完整调用链路图

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│  Renderer    │────►│  IPC/Bridge  │────►│  llm-api.ts      │────►│  AgentLoop   │
│  (React)     │     │              │     │                  │     │  (loop.ts)   │
│              │     │ ipc-handlers │     │ chatWithLlmApi() │     │              │
│ Zustand Store│     │ dev-bridge   │     │ streamChatWith   │     │ run()        │
│              │     │              │     │ LlmApi()         │     │              │
└──────────────┘     └──────────────┘     └──────────────────┘     └──────┬───────┘
                                                                         │
                                                                         ▼
                                                               ┌──────────────────┐
                                                               │  ToolRegistry    │
                                                               │  (tool-registry) │
                                                               │                  │
                                                               │ execute(name,    │
                                                               │   args, context) │
                                                               └──────┬───────────┘
                                                                      │
                                              ┌───────────────────────┼───────────────────────┐
                                              ▼                       ▼                       ▼
                                   ┌──────────────────┐   ┌──────────────────┐   ┌──────────────────┐
                                   │  workspace.ts    │   │  shell.ts        │   │  web.ts          │
                                   │  file_read       │   │  shell_exec      │   │  web_fetch       │
                                   │  file_write      │   │                  │   │                  │
                                   │  workspace_files │   │ spawn()          │   │ fetch()          │
                                   │  workspace_search│   └──────────────────┘   └──────────────────┘
                                   └──────────────────┘
```

---

## 7. 安全机制

### 7.1 Shell 命令安全

```typescript
function isDenied(command: string): boolean {
  return /\b(rm\s+-rf\s+\/|mkfs|diskutil\s+erase|shutdown|reboot)\b/.test(command);
}
```

拒绝执行明显具有破坏性的命令。

### 7.2 路径逃逸防护

```typescript
function resolveWorkspacePath(cwd: string, inputPath: string): string {
  const resolved = path.resolve(cwd, inputPath || '.');
  const root = path.resolve(cwd);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }
  return resolved;
}
```

所有文件操作工具都通过此函数解析路径，防止 `../../etc/passwd` 等路径逃逸攻击。

### 7.3 文本截断限制

| 场景 | 上限 |
|------|------|
| 单文件读取 (`file_read`) | 60KB |
| 批量读取总上限 (`file_read_many`) | 80KB |
| 单文件最大读取 | 20KB |
| Shell stdout | 30KB |
| Shell stderr | 30KB |
| Web 抓取 | 50KB |
| Shell 超时 | 180s (默认60s) |

### 7.4 API 密钥安全

```typescript
function resolveApiKey(config: LlmApiConfig): string {
  // 1. 优先使用 config.apiKey
  // 2. 从 .env 文件中读取环境变量
  // 3. 从 process.env 中读取
  // 4. 支持多个候选环境变量名
}
```

密钥不会在日志或事件中暴露。

---

## 8. 关键设计决策

### 8.1 为什么使用流式 (stream: true)

- 实时显示模型思考过程，提升用户体验
- 支持逐 token 渲染 tool_calls，减少首 token 延迟
- 用户可以在模型思考过程中提前感知进度

### 8.2 为什么单轮超时 90s

- 平衡用户体验和模型响应时间
- 如果模型超时但工具已执行，fallback 机制保证不丢失结果
- 整体任务超时 600s (10分钟) 由调用方控制

### 8.3 为什么最大轮次 20

- 防止无限循环
- 大多数任务在 3-8 轮内完成
- 20 轮足够处理复杂的多步骤任务

### 8.4 为什么 tool_choice 固定为 'auto'

- 让模型自主决定是否调用工具
- 不强制工具调用，允许纯文本回复
- 模型可以自由选择"思考→行动→观察"的节奏

### 8.5 为什么 temperature 固定 0.2

- 降低随机性，提高工具调用的确定性
- 适合代码生成和文件操作场景
- 减少幻觉和错误的工具调用

### 8.6 为什么使用 Map 存储 tool_calls

- 支持分块传输的 SSE 流
- 按 index 排序保证工具调用顺序
- 去重处理（同一个 index 多次 delta）

---

## 9. 状态机

```
                    ┌─────────────────────────────────────────────┐
                    │              Agent Loop 状态机               │
                    └─────────────────────────────────────────────┘

    [*] ──→ thinking: 用户发送消息，模型开始分析任务
                  │
                  ├──→ streaming: 模型开始流式输出文本
                  │         │
                  │         ├──→ executing: 模型返回 tool_calls，开始执行工具
                  │         │         │
                  │         │         └──→ post_tool: 工具执行完成，等待模型总结
                  │         │                   │
                  │         │                   ├──→ streaming: 模型继续推理（下一轮）
                  │         │                   └──→ thinking: 模型继续推理（下一轮）
                  │         │
                  │         └──→ done: 模型返回纯文本（无 tool_calls）
                  │
                  └──→ executing: 模型直接返回 tool_calls（无文本）
                            │
                            └──→ post_tool → ... → done

    状态说明:
    - thinking:   模型正在分析任务，尚未输出任何内容
    - streaming:  模型正在流式输出文本内容
    - executing:  正在执行工具调用
    - post_tool:  工具执行完成，结果已加入对话，等待模型下一轮推理
    - done:       任务完成，返回最终结果
```

---

## 10. 扩展点

### 10.1 添加新工具

1. 在 `src/main/agent-core/tools/` 下创建工具文件
2. 实现 `AgentTool` 接口（name, schema, run）
3. 在 `default-tools.ts` 中注册

```typescript
// 示例：添加一个计算器工具
export const calculatorTool: AgentTool = {
  name: 'calculator',
  schema: {
    type: 'function',
    function: {
      name: 'calculator',
      description: 'Perform arithmetic calculation.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression to evaluate.' },
        },
        required: ['expression'],
      },
    },
  },
  async run(args) {
    const expression = String(args.expression || '');
    return { result: eval(expression) }; // 注意：实际使用需安全评估
  },
};
```

### 10.2 自定义 System Prompt

修改 `buildSystemPrompt()` 函数即可调整模型行为：

```typescript
function buildSystemPrompt(): string {
  return [
    'You are PigAgent, a Codex-style desktop software agent.',
    // ... 添加自定义指令
  ].join('\n');
}
```

### 10.3 支持更多 LLM Provider

在 `llm-api.ts` 中，`chatWithLlmApi()` 和 `streamChatWithLlmApi()` 已经支持任何 OpenAI 兼容的 API。只需在设置中添加新的 `LlmApiConfig` 即可。

---

## 11. 文件清单

| 文件 | 职责 |
|------|------|
| `src/main/agent-core/loop.ts` | Agent Loop 主循环，LLM 通信，SSE 解析 |
| `src/main/agent-core/types.ts` | 核心类型定义（消息、工具、事件、选项） |
| `src/main/agent-core/tool-registry.ts` | 工具注册表，执行调度 |
| `src/main/agent-core/default-tools.ts` | 默认工具集注册 |
| `src/main/agent-core/tools/workspace.ts` | 工作区文件操作工具 |
| `src/main/agent-core/tools/shell.ts` | Shell 命令执行工具 |
| `src/main/agent-core/tools/web.ts` | HTTP 请求工具 |
| `src/main/agent-core/tools/weather.ts` | 天气查询工具 |
| `src/main/agent-core/tools/patch.ts` | Git patch 应用工具 |
| `src/main/agent-core/tools/shared.ts` | 工具共享函数（路径解析、文本截断） |
| `src/main/llm-api.ts` | API 密钥解析，AgentLoop 入口封装 |
| `src/main/dev-bridge.ts` | 开发模式 HTTP Bridge |
| `src/main/ipc-handlers.ts` | Electron IPC 处理器 |
| `src/main/session-manager.ts` | 会话持久化管理 |
| `src/main/agent-runtime/runtime.ts` | Agent Runtime（多 provider 管理） |
| `src/main/agent-runtime/provider-registry.ts` | Provider 注册与发现 |
