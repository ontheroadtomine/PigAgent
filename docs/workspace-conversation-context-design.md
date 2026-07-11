# Workspace / Conversation / Context 设计与实现

本文档描述 Nexa 左侧工作区与对话管理的设计，以及它如何配合 context/memory 系统工作。

## 1. 设计目标

Nexa 的对话不能只是一串聊天消息。对 agent 来说，工作目录、对话、工具结果、文件产物都属于上下文的一部分。

目标结构是：

```text
Workspace
  ├── Workspace Memory
  ├── Conversation A
  │     ├── Transcript
  │     └── Conversation Memory
  └── Conversation B
        ├── Transcript
        └── Conversation Memory
```

其中：

- Workspace 表示一个项目目录。
- Conversation 表示该项目下的一条任务会话。
- Workspace Memory 是项目级长期记忆。
- Conversation Memory 是对话级短期记忆。
- Transcript 是完整消息记录，用于 UI 恢复、debug、resume。

## 2. Codex / Claude 的参考设计

### 2.1 Codex

Codex 的核心是：

```text
工作目录 + 本地 session transcript + 可 resume 的会话
```

同一个 session 绑定当前工作目录。工具执行、文件读取、patch 都围绕这个目录进行。

对 Nexa 的启发：

- 每个 Conversation 必须绑定 Workspace。
- 工具执行必须以 Workspace.path 作为 cwd。
- 对话 transcript 应该本地持久化。
- 后续 resume/fork 应基于 transcript。

### 2.2 Claude Code

Claude Code 的核心是：

```text
项目目录 + 项目级 memory/CLAUDE.md + 当前 session context
```

项目级记忆用于保存长期规则、项目摘要、重要决策；session context 用于保存当前任务进展。

对 Nexa 的启发：

- Workspace Memory 类似项目级 memory。
- Conversation Memory 类似当前 session context。
- 旧工具结果不能无限塞入上下文，需要摘要化。
- 文件产物应结构化记录，而不是只放在聊天文本里。

## 3. UI 设计

左侧栏结构：

```text
Workspaces
  + Add Workspace

  Nexa
    + New Chat
    New conversation
    修复 DeepSeek 超时

  Nexa
    + New Chat
    部署脚本分析
```

交互规则：

1. 点击 `+` 添加 Workspace。
2. 添加 Workspace 时用户输入目录绝对路径。
3. 每个 Workspace 下可以新建 Conversation。
4. 点击 Workspace 会加载该目录下的 Conversations。
5. 点击 Conversation 会恢复该会话 transcript 和 Conversation Memory。
6. 执行中禁止切换 Workspace/Conversation，避免运行中的 cwd/context 错位。

## 4. Context 组装规则

每次请求模型时，Context Builder 按以下顺序组装：

```text
system prompt
workspace memory
conversation memory
recent conversation messages
current user prompt
```

对应 payload：

```ts
interface AgentContextPayload {
  recentMessages: AgentContextMessage[];
  memory: AgentMemory;
  workspaceMemory?: WorkspaceMemory;
}
```

其中：

- `workspaceMemory` 解决“这个项目长期是什么情况”。
- `memory` 解决“这个对话刚才做了什么”。
- `recentMessages` 保留最近几轮原文。

## 5. Workspace Memory

Workspace Memory 是项目级长期记忆，多个 Conversation 共享。

```ts
interface WorkspaceMemory {
  projectSummary?: string;
  filesTouched: FileTouchRecord[];
  artifacts: ArtifactRecord[];
  decisions: DecisionRecord[];
}
```

用途：

- 新对话也能知道这个 workspace 最近生成过哪些文档。
- 用户说“这个项目之前生成的架构文档”，可以从 artifacts 里找。
- 项目级总结可作为轻量版 `NEXA.md`。

## 6. Conversation Memory

Conversation Memory 是单个对话的短期记忆。

```ts
interface AgentMemory {
  conversationSummary?: string;
  filesTouched: FileTouchRecord[];
  artifacts: ArtifactRecord[];
  toolSummaries: ToolResultSummary[];
}
```

用途：

- 解决“刚才那个文件”“上一步”“继续完善”。
- 保存该会话内读写过的文件。
- 保存工具结果摘要。
- 任务结束后更新 conversation summary。

## 7. Transcript

Transcript 是完整聊天记录：

```ts
ChatMessage[]
```

用途：

- 页面刷新后恢复当前对话。
- 切换 Conversation 后恢复消息。
- 后续实现 resume/fork/debug。

Transcript 不等于每次都完整发给模型。模型上下文由 Context Builder 选择最近消息和摘要。

## 8. 已实现的 1-7 步

### 8.1 左侧恢复 Workspace/Conversation 树

新增：

```text
src/renderer/components/workspace/WorkspaceSidebar.tsx
```

并在：

```text
src/renderer/components/layout/MainLayout.tsx
```

中恢复左侧栏布局。

### 8.2 支持 Add Workspace

用户可以通过左侧 `+` 输入目录绝对路径添加工作区。

浏览器预览模式下存入 localStorage。

Electron 模式下通过 `SessionManager.addWorkspace()` 存入本地 database。

### 8.3 支持 Workspace 下 New Chat

每个 Workspace 右侧有新建对话按钮。

新建后：

- 绑定当前 workspaceId。
- 清空 messages。
- 初始化 Conversation Memory。

### 8.4 Memory 按 Workspace + Conversation 隔离

当前实现：

```text
workspace memory key:
nexa.workspaceMemory.{workspaceId}

conversation memory key:
nexa.agentMemory.{conversationId}

transcript key:
nexa.transcript.{conversationId}
```

不同 workspace 不共享 workspace memory。

同 workspace 下不同 conversation：

- 共享 workspace memory。
- 不共享 conversation memory。

### 8.5 Context Builder 注入 Workspace Memory + Conversation Memory

后端：

```text
src/main/agent-core/context-builder.ts
```

已支持：

- project summary
- workspace artifacts
- workspace touched files
- workspace decisions
- conversation summary
- conversation artifacts
- conversation touched files
- recent tool summaries
- recent messages

### 8.6 Transcript 按 Conversation 持久化

每次发送消息、收到模型状态、工具结果、最终回复时，都会保存当前 messages。

切换 Conversation 时：

- 保存旧 transcript。
- 加载新 transcript。
- 加载新 Conversation Memory。

### 8.7 Workspace 级 Project Summary / Artifact

收到 `final` 后：

- 更新 Conversation Summary。
- 同步更新 Workspace Project Summary。

收到 `file_write` / `apply_patch` 等工具结果后：

- 更新 Conversation filesTouched/artifacts。
- 同步更新 Workspace filesTouched/artifacts。

这样新对话也能感知该 workspace 中最近生成过的文档和修改过的文件。

## 9. 当前实现文件

主要改动：

```text
src/shared/types.ts
src/main/agent-core/context-builder.ts
src/renderer/stores/app-store.ts
src/renderer/components/workspace/WorkspaceSidebar.tsx
src/renderer/components/layout/MainLayout.tsx
```

相关已有链路：

```text
src/main/dev-bridge.ts
src/main/llm-api.ts
src/main/ipc-handlers.ts
src/main/preload.ts
```

## 10. 后续增强

当前 Add Workspace 使用路径输入。后续可在 Electron 中增加原生目录选择器：

```ts
dialog.showOpenDialog({
  properties: ['openDirectory']
})
```

后续还可以增加：

- 删除 Workspace。
- 删除 Conversation。
- 重命名 Conversation。
- 自动从 `NEXA.md` 加载 workspace rules。
- 支持 Fork Conversation。
- 支持真正的 model-based compaction。
