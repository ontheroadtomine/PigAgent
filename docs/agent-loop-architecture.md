# Nexa Agent Loop Architecture

## Goal

Nexa now targets a Codex-style agent runtime rather than a plain chat wrapper. The model is only one component. The application owns the loop, tools, workspace access, command execution, observation, and final answer.

## Codex-Inspired Runtime Shape

Codex-like agents follow this pattern:

1. Build task context from user prompt, workspace, policies, and available tools.
2. Send the model a tool-aware request.
3. If the model returns tool calls, execute them in the host process.
4. Append tool observations back into the conversation.
5. Repeat until the model returns a final answer or a turn limit is reached.
6. Verify work with commands/tests when files or behavior changed.

Nexa implements that same host-owned loop in `src/main/agent-core/loop.ts`.

## Implemented Components

- `AgentLoop`: multi-turn loop with `tools`, `tool_choice: auto`, tool observations, max-turn protection, and final answer extraction.
- `ToolRegistry`: stable registration and execution boundary for local tools.
- Workspace tools:
  - `workspace_list`
  - `file_read`
  - `file_write`
- Execution tools:
  - `shell_exec`
  - `apply_patch`
- Web/current-data tools:
  - `web_fetch`
  - `weather_current`
- Provider bridge:
  - DeepSeek/OpenAI-compatible Chat Completions calls are adapted into the same loop.
  - Browser preview and Electron IPC both call the same backend path.

## File Map

- `src/main/agent-core/loop.ts`: model/tool turn loop.
- `src/main/agent-core/tool-registry.ts`: registry and guarded tool dispatch.
- `src/main/agent-core/default-tools.ts`: default Codex-like tool set.
- `src/main/agent-core/tools/*.ts`: concrete tools.
- `src/main/llm-api.ts`: API key resolution, health check, and AgentLoop entrypoint.
- `src/main/dev-bridge.ts`: browser-preview backend endpoints.
- `src/main/ipc-handlers.ts`: Electron backend endpoints.
- `src/renderer/stores/app-store.ts`: passes workspace cwd into the agent loop.

## Current Capability Level

Nexa can now:

- answer realtime weather through tool use;
- fetch public URLs when a URL is known;
- inspect workspace files and directories;
- write files;
- run shell commands in the selected workspace;
- apply unified diff patches;
- use the same DeepSeek model as an agent backend instead of plain chat.

This is the foundation for Codex-class behavior. The largest remaining gaps are streaming tool events in the UI, permission policies, MCP integration, richer context packing, persistent session replay, and browser automation tools.

## Upstream Codex Tracking Mechanism

The repo includes `scripts/codex-reference-sync.mjs`.

Run:

```bash
node scripts/codex-reference-sync.mjs
```

It maintains:

- `.nexa-reference/codex`: a shallow local reference checkout of OpenAI Codex.
- `docs/codex-reference-lock.json`: the upstream commit, sync time, and watched source paths.

When Codex updates, run the script, inspect the changed watched files, and map new behavior into Nexa through adapters rather than copy-pasting into UI code.

## Update Workflow

1. Sync upstream reference.
2. Compare `docs/codex-reference-lock.json` commit with previous commit.
3. Inspect changed files under Codex core/exec/protocol/MCP/tool areas.
4. Classify changes:
   - loop behavior;
   - tool schema/protocol;
   - sandbox/permission;
   - context packing;
   - streaming events;
   - MCP/plugin behavior.
5. Implement equivalent behavior in `src/main/agent-core`.
6. Add or update tests and manual verification prompts.

## Next Implementation Targets

1. Stream intermediate `tool_use` and `tool_result` blocks into the chat UI for DeepSeek agent runs.
2. Add policy modes: read-only, workspace-write, full-access.
3. Add MCP tool discovery and invocation.
4. Add browser automation as a first-class tool.
5. Add persistent conversation replay with compacted tool history.
6. Add context budget management and file relevance selection.
7. Add regression tests for the loop and tool registry.
