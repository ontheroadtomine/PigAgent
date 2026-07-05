# Agent Loop 流程图

> 使用 Mermaid 语法绘制，可在支持 Mermaid 的 Markdown 渲染器中查看。

---

## 1. 主循环流程图

```mermaid
flowchart TD
    Start(["用户输入 prompt"]) --> Init["构建 System Prompt + User Message\n初始化 toolCallsLog = []"]
    Init --> LoopStart{"for turn = 0; turn < maxTurns (20); turn++"}

    LoopStart --> StatusEvent["发送 status 事件\n(turn===0 ? 'thinking' : 'streaming')"]
    StatusEvent --> CreateRoundSignal["创建 Round Signal\n超时 90s + 父级 AbortSignal"]

    CreateRoundSignal --> RequestStream["requestChatCompletionStream()\nPOST /v1/chat/completions\nstream: true, tool_choice: auto"]

    RequestStream --> ParseSSE{"SSE 流解析"}
    ParseSSE -->|"delta.content"| TextDelta["onText(delta)\n→ text_delta 事件"]
    ParseSSE -->|"delta.tool_calls"| AccumulateTool["累积到 toolCallMap\n按 index 排序去重"]
    ParseSSE -->|"[DONE]"| StreamEnd["流结束"]

    TextDelta --> ParseSSE
    AccumulateTool --> ParseSSE

    StreamEnd --> CheckToolCalls{"toolCalls.length === 0 ?"}

    CheckToolCalls -->|"YES"| ReturnResult["返回 { content, turns, toolCallsLog }\n任务完成 ✅"]
    CheckToolCalls -->|"NO"| PushAssistantMsg["将 assistant message\n(含 tool_calls) 加入 messages"]

    PushAssistantMsg --> LoopTools["遍历每个 tool_call"]

    LoopTools --> ParseArgs["parseArgs()\n解析 JSON 参数"]
    ParseArgs --> ToolStartEvent["发送 tool_start 事件"]
    ToolStartEvent --> StatusExecuting["发送 status: 'executing' 事件"]
    StatusExecuting --> ExecuteTool["tools.execute(name, args, { cwd })"]

    ExecuteTool --> RecordLog["记录 toolCallsLog"]
    RecordLog --> ToolResultEvent["发送 tool_result 事件"]
    ToolResultEvent --> StatusPostTool["发送 status: 'post_tool' 事件"]
    StatusPostTool --> PushToolMsg["将 tool role message\n(含结果) 加入 messages"]

    PushToolMsg --> NextTool{"还有下一个 tool_call ?"}
    NextTool -->|"YES"| LoopTools
    NextTool -->|"NO"| LoopStart

    %% 超时处理分支
    RequestStream -->|"超时异常"| TimeoutCheck{"isModelRoundTimeout ?\n且已有成功的工具调用 ?"}
    TimeoutCheck -->|"YES"| Fallback["buildFallbackSummary()\n生成结构化 fallback 总结"]
    Fallback --> ReturnFallback["返回 fallback 总结\n不抛出异常"]
    TimeoutCheck -->|"NO"| ThrowTimeout["抛出 ModelRoundTimeoutError"]

    %% 最大轮次处理
    LoopStart -->|"turn >= maxTurns"| MaxTurnsError["抛出 Error\n'Agent loop reached max turns (N)'"]

    %% 样式
    classDef process fill:#e1f5fe,stroke:#0288d1,stroke-width:2px
    classDef decision fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef terminal fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef error fill:#fce4ec,stroke:#d32f2f,stroke-width:2px

    class Init,StatusEvent,CreateRoundSignal,RequestStream,ParseSSE,TextDelta,AccumulateTool,StreamEnd,PushAssistantMsg,LoopTools,PushToolMsg,ParseArgs,ToolStartEvent,StatusExecuting,ExecuteTool,RecordLog,ToolResultEvent,StatusPostTool,Fallback process
    class CheckToolCalls,NextTool,TimeoutCheck decision
    class ReturnResult,ReturnFallback terminal
    class ThrowTimeout,MaxTurnsError error
```

---

## 2. 流式 SSE 解析流程

```mermaid
sequenceDiagram
    participant AgentLoop
    participant LLM_API as LLM API
    participant Renderer

    AgentLoop->>LLM_API: POST /v1/chat/completions (stream: true)
    Note over AgentLoop,LLM_API: body: { messages, tools, tool_choice: 'auto', temperature: 0.2 }

    LLM_API-->>AgentLoop: SSE: data: {"choices":[{"delta":{"content":"分析"}}]}
    AgentLoop->>Renderer: text_delta { delta: "分析" }

    LLM_API-->>AgentLoop: SSE: data: {"choices":[{"delta":{"content":"任务"}}]}
    AgentLoop->>Renderer: text_delta { delta: "任务" }

    LLM_API-->>AgentLoop: SSE: data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"workspace_files","arguments":"{\"limit\":300}"}}]}}]}
    Note over AgentLoop: 累积到 toolCallMap[0]

    LLM_API-->>AgentLoop: SSE: data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}
    Note over AgentLoop: 继续累积

    LLM_API-->>AgentLoop: SSE: data: [DONE]
    Note over AgentLoop: 流结束，返回 { content, toolCalls }
```

---

## 3. 工具执行流程

```mermaid
sequenceDiagram
    participant AgentLoop
    participant ToolRegistry
    participant Tool as 具体 Tool
    participant Renderer

    AgentLoop->>AgentLoop: 解析 tool_call JSON 参数
    AgentLoop->>Renderer: tool_start { name, args }
    AgentLoop->>Renderer: status: 'executing'

    AgentLoop->>ToolRegistry: execute(name, args, { cwd })
    ToolRegistry->>Tool: run(args, context)

    alt 执行成功
        Tool-->>ToolRegistry: { ok: true, result: {...} }
        ToolRegistry-->>AgentLoop: { ok: true, result: {...} }
        AgentLoop->>Renderer: tool_result { name, ok: true, output }
    else 执行失败
        Tool-->>ToolRegistry: throw Error(...)
        ToolRegistry-->>AgentLoop: { ok: false, error: "..." }
        AgentLoop->>Renderer: tool_result { name, ok: false, output }
    end

    AgentLoop->>Renderer: status: 'post_tool'
    AgentLoop->>AgentLoop: 将 tool role message 加入 messages
    Note over AgentLoop: 下一轮循环
```

---

## 4. 完整调用链路

```mermaid
flowchart LR
    subgraph Renderer["Renderer (React)"]
        Store["Zustand Store\napp-store.ts"]
        UI["ChatPanel\nMessageBubble"]
    end

    subgraph IPC["IPC Layer"]
        Bridge["Bridge (HTTP)\nlocalhost:9876"]
        IPC_Channel["Electron IPC\nipcMain.handle"]
    end

    subgraph Main["Main Process"]
        LlmApi["llm-api.ts\nchatWithLlmApi / streamChatWithLlmApi"]
        AgentLoop["AgentLoop\nloop.ts"]
        ToolReg["ToolRegistry\ntool-registry.ts"]
        Tools["Tools\nworkspace / shell / web / weather / patch"]
    end

    subgraph External["External"]
        LLM["LLM API\nOpenAI-compatible"]
        FS["File System"]
        Shell["Shell"]
        Web["HTTP"]
    end

    UI -->|"用户输入"| Store
    Store -->|"sendMessage()"| Bridge
    Store -->|"sendMessage()"| IPC_Channel

    Bridge -->|"POST /llm-api/stream"| LlmApi
    IPC_Channel -->|"IPC.LLM_API_CHAT"| LlmApi

    LlmApi -->|"new AgentLoop()"| AgentLoop
    AgentLoop -->|"tools.execute()"| ToolReg
    ToolReg -->|"tool.run()"| Tools

    AgentLoop -->|"fetch()"| LLM
    Tools -->|"fs.readFile/writeFile"| FS
    Tools -->|"spawn()"| Shell
    Tools -->|"fetch()"| Web

    AgentLoop -->|"onEvent()"| LlmApi
    LlmApi -->|"SSE / IPC"| Store
    Store -->|"React re-render"| UI
```

---

## 5. 状态机

```mermaid
stateDiagram-v2
    [*] --> thinking: 用户发送消息
    thinking --> streaming: 模型开始返回文本
    thinking --> executing: 模型返回 tool_calls
    streaming --> executing: 模型返回 tool_calls
    executing --> post_tool: 工具执行完成
    post_tool --> streaming: 模型继续推理（下一轮）
    post_tool --> thinking: 模型继续推理（下一轮）
    streaming --> done: 模型返回纯文本（无 tool_calls）
    executing --> done: 模型返回纯文本（无 tool_calls）
    done --> [*]

    note right of thinking: 分析任务阶段
    note right of executing: 执行工具阶段
    note right of streaming: 模型流式输出文本
    note right of post_tool: 工具结果已返回，等待模型总结
```

---

## 6. 超时与错误处理流程

```mermaid
flowchart TD
    StartRound["开始一轮请求"] --> Request["requestChatCompletionStream()"]
    Request --> Timeout{"90s 超时?"}

    Timeout -->|"是"| HasToolCalls{"toolCallsLog\n有成功的工具调用?"}
    HasToolCalls -->|"是"| BuildFallback["buildFallbackSummary()\n列出已完成的工具"]
    BuildFallback --> ReturnFallback["返回 fallback 文本\n不抛出异常"]
    HasToolCalls -->|"否"| ThrowTimeout["抛出 ModelRoundTimeoutError"]

    Timeout -->|"否"| NormalReturn["正常返回结果"]

    Request -->|"HTTP 错误"| ThrowHTTP["抛出 Error\nHTTP {status}: {detail}"]
    Request -->|"父级 AbortSignal"| ThrowAbort["抛出 AbortError"]

    NormalReturn --> CheckToolCalls{"toolCalls 为空?"}
    CheckToolCalls -->|"是"| Done["返回结果 ✅"]
    CheckToolCalls -->|"否"| ExecuteTools["执行工具"]
    ExecuteTools --> NextRound["下一轮"]

    NextRound --> MaxTurns{"turn >= maxTurns?"}
    MaxTurns -->|"是"| ThrowMaxTurns["抛出 Error\n'Agent loop reached max turns (20)'"]
    MaxTurns -->|"否"| StartRound
```

---

## 7. Round Signal 生命周期

```mermaid
sequenceDiagram
    participant AgentLoop
    participant Timer as 90s Timer
    participant Parent as 父级 AbortSignal
    participant LLM as LLM API

    AgentLoop->>AgentLoop: createRoundSignal(parentSignal)
    AgentLoop->>Timer: setTimeout(90s)
    AgentLoop->>Parent: addEventListener('abort')

    AgentLoop->>LLM: requestChatCompletionStream(..., signal)

    alt 正常完成
        LLM-->>AgentLoop: 响应完成
        AgentLoop->>Timer: clearTimeout()
        AgentLoop->>Parent: removeEventListener('abort')
    else 90s 超时
        Timer-->>AgentLoop: abort(ModelRoundTimeoutError)
        AgentLoop->>LLM: 请求被中止
    else 父级取消
        Parent-->>AgentLoop: abort(reason)
        AgentLoop->>Timer: clearTimeout()
        AgentLoop->>LLM: 请求被中止
    end
```

---

## 8. 数据流图

```mermaid
flowchart TD
    subgraph Input["输入层"]
        UserPrompt["用户 Prompt"]
        Config["LLM API 配置\n(baseUrl, model, apiKey)"]
        Cwd["工作目录"]
    end

    subgraph Loop["Agent Loop 核心"]
        SP["buildSystemPrompt()\n构建系统提示词"]
        MSG["messages[]\n对话历史"]
        LLMReq["requestChatCompletionStream()\n请求 LLM"]
        SSE["SSE 流解析\ncontent + tool_calls"]
        Check{"toolCalls\n为空?"}
        Exec["执行工具\nToolRegistry.execute()"]
        Log["toolCallsLog\n记录日志"]
    end

    subgraph Output["输出层"]
        Final["最终文本回复"]
        Events["事件流\nstatus / text_delta /\ntool_start / tool_result"]
        Fallback["超时 Fallback"]
    end

    UserPrompt --> SP
    Config --> LLMReq
    Cwd --> Exec
    SP --> MSG
    MSG --> LLMReq
    LLMReq --> SSE
    SSE --> Check
    Check -->|"是"| Final
    Check -->|"否"| Exec
    Exec --> Log
    Log --> MSG
    MSG -->|"下一轮"| LLMReq

    SSE -.->|"实时"| Events
    Exec -.->|"实时"| Events
    Log -.-> Fallback
```

---

## 9. 工具注册架构

```mermaid
flowchart TD
    subgraph Registry["ToolRegistry"]
        Register["register(tool)"]
        Schemas["schemas()\n返回所有 OpenAI Schema"]
        Execute["execute(name, args, context)"]
        Map["Map<string, AgentTool>"]
    end

    subgraph Tools["工具实现"]
        WS["workspace.ts\nfile_read / file_write\nworkspace_list / workspace_files\nworkspace_search"]
        SH["shell.ts\nshell_exec"]
        WEB["web.ts\nweb_fetch"]
        WTH["weather.ts\nweather_current"]
        PATCH["patch.ts\napply_patch"]
    end

    subgraph Default["default-tools.ts"]
        Create["createDefaultToolRegistry()"]
    end

    Create --> Register
    Register --> Map
    Schemas --> Map
    Execute --> Map

    Map --> WS
    Map --> SH
    Map --> WEB
    Map --> WTH
    Map --> PATCH
```

---

## 10. 时序总览

```mermaid
sequenceDiagram
    participant User as 用户
    participant UI as Renderer UI
    participant Store as Zustand Store
    participant IPC as IPC/Bridge
    participant Loop as AgentLoop
    participant Tools as ToolRegistry
    participant LLM as LLM API

    User->>UI: 输入 prompt
    UI->>Store: sendMessage()
    Store->>IPC: chatLlmApi(config, prompt, cwd)

    Note over Loop: === 第 1 轮 ===
    IPC->>Loop: run({ config, apiKey, prompt, cwd, onEvent })
    Loop->>LLM: POST /v1/chat/completions (stream: true)
    LLM-->>Loop: SSE: text_delta (思考过程)
    Loop-->>IPC: onEvent(text_delta)
    IPC-->>Store: 更新消息
    Store-->>UI: 实时渲染

    LLM-->>Loop: SSE: tool_calls [workspace_files]
    Loop->>Tools: execute("workspace_files", { limit: 300 }, { cwd })
    Tools-->>Loop: { ok: true, result: [...] }
    Loop-->>IPC: onEvent(tool_result)
    IPC-->>Store: 更新消息

    Note over Loop: === 第 2 轮 ===
    Loop->>LLM: POST (含工具结果)
    LLM-->>Loop: SSE: text_delta (分析文件列表)
    LLM-->>Loop: SSE: tool_calls [file_read_many]
    Loop->>Tools: execute("file_read_many", { paths: [...] }, { cwd })
    Tools-->>Loop: { ok: true, result: { files: [...] } }
    Loop-->>IPC: onEvent(tool_result)

    Note over Loop: === 第 3 轮 ===
    Loop->>LLM: POST (含文件内容)
    LLM-->>Loop: SSE: text_delta (最终回答)
    LLM-->>Loop: SSE: [DONE] (无 tool_calls)
    Loop-->>IPC: onEvent(final)
    IPC-->>Store: 完成
    Store-->>UI: 显示最终回复
    UI-->>User: 展示结果
```
