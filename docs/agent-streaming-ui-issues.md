# Agent 流式输出与工具过程展示问题复盘

本文档整理近期在 PigAgent 聊天界面中暴露的几个问题、根因分析以及已经采用或建议采用的解决方案。

## 1. 问题现象

在执行复杂 agent 任务时，例如：

> 梳理当前 agent loop 的核心实现逻辑，输出详细文档、流程图、Markdown 文件

界面中会出现以下现象：

1. 工具调用和工具结果正常出现，例如 `workspace_files`、`file_read_many`、`file_write result`。
2. 大模型生成的文本内容有时显示在工具调用上方。
3. 工具过程显示在下方，导致阅读顺序变成：

```text
最终总结内容
workspace_files
workspace_files result
file_read_many
file_read_many result
```

这会让用户误以为模型先给出了结论，后面才执行工具，和真实 agent loop 顺序不一致。

## 2. 根因分析

### 2.1 流式输出和工具调用事件交错

当前 DeepSeek agent loop 已支持流式输出，后端会向前端推送类似事件：

```text
status
text_start
text_delta
tool_start
tool_result
status
text_delta
final
```

如果模型在同一轮里先输出了一些文本，然后又决定调用工具，前端会按事件到达顺序追加 block。

因此 `text` block 可能先被插入到消息 blocks 里，后续工具 block 再追加到它后面。

### 2.2 UI 直接按 blocks 原始顺序渲染

原先 `MessageBubble` 中的渲染逻辑是：

```tsx
blocks.map(block => <BlockRenderer block={block} />)
```

这意味着 UI 顺序完全依赖事件到达顺序，而不是用户理解 agent 过程时更自然的顺序。

对于 agent 场景，用户更关心的是：

```text
思考过程
工具调用
工具结果
最终回复
```

而不是底层 SSE 事件真实抵达顺序。

### 2.3 复杂任务更容易触发该问题

简单问题通常只有最终文本，不会出现错位。

复杂任务会经历多轮：

1. 先分析任务
2. 列工作区文件
3. 批量读取代码
4. 写入文档
5. 最后总结

在这个过程中，模型可能在工具调用前后都输出文本，因此更容易出现文本块和工具块交错。

## 3. 解决方案

### 3.1 UI 层固定展示顺序

前端不再直接使用 blocks 原始顺序渲染，而是在展示时进行排序：

```tsx
const orderedBlocks = [
  ...blocks.filter(block => block.type !== 'text'),
  ...blocks.filter(block => block.type === 'text'),
];
```

这样无论事件实际到达顺序如何，界面始终展示为：

```text
思考
工具调用
工具结果
最终文本
```

### 3.2 保留底层事件顺序

该方案只改变 UI 展示顺序，不改变底层数据结构。

也就是说：

- `blocks` 仍然按事件到达顺序记录。
- 渲染时使用 `orderedBlocks`。
- 复制整条消息时仍基于原始 blocks 拼接。

这样做的好处是改动小、风险低，不会影响 agent loop 的事件处理。

### 3.3 后续更完整的设计

更理想的长期方案是将 assistant message 拆成两个区域：

```ts
interface AssistantMessage {
  processBlocks: ContentBlock[]; // thinking/tool_use/tool_result/status
  answerBlocks: ContentBlock[];  // text
}
```

这样数据层就能明确区分：

- 执行过程
- 最终回答

但这会影响较多代码，包括 store、渲染器、复制逻辑和历史消息结构，因此当前先采用 UI 排序方案。

## 4. 已完成改动

文件：

```text
src/renderer/components/chat/MessageBubble.tsx
```

核心改动：

```tsx
const orderedBlocks = [
  ...blocks.filter(block => block.type !== 'text'),
  ...blocks.filter(block => block.type === 'text'),
];

{orderedBlocks.map((block) => (
  <BlockRenderer key={block.id} block={block} messageStatus={status} />
))}
```

## 5. 相关问题与改进方向

### 5.1 工具完成后等待最终总结

之前在 `file_write result` 后，如果模型最终总结慢，会让用户误以为卡住。

已加入 `post_tool` 状态：

```text
工具执行完成，正在整理最终回复
```

### 5.2 最终总结超时

如果工具已经成功，但最终总结模型请求超时，不应直接显示 `Request timed out`。

已调整为 fallback summary：

```text
模型最终总结响应超时，但以下工具操作已经完成：

- file_write：created docs/example.md

你可以根据上面的工具结果继续操作，或重新发送“总结刚才的结果”。
```

### 5.3 流式输出体验

最终回复已支持 `text_delta`，可以像打字机一样逐步显示。

后续可继续优化：

- 将流式文本固定渲染在最终回答区域。
- 将工具过程折叠成 timeline。
- 对 `file_write`、`apply_patch` 等关键工具提供更清晰的成功摘要。

## 6. 当前推荐原则

PigAgent 的聊天消息展示应遵循：

1. 过程优先于结论展示。
2. 工具调用和工具结果保持相邻。
3. 最终文本永远放在消息末尾。
4. 工具成功结果不应被后续模型超时覆盖。
5. UI 展示顺序可以不同于底层事件到达顺序，但需要保持用户理解上的因果顺序。
