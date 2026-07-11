import { ToolRegistry } from './tool-registry';
import { artifactRecordTool, askUserQuestionTool, contextCompactTool, planUpdateTool } from './tools/agent-control';
import { applyPatchTool } from './tools/patch';
import { shellExecTool } from './tools/shell';
import { fileReadManyTool, fileReadTool, fileWriteTool, listDirTool, workspaceFilesTool, workspaceSearchTool } from './tools/workspace';
import { weatherCurrentTool } from './tools/weather';
import { browserOpenTool, webFetchTool, webOpenTool, webResearchTool, webSearchTool } from './tools/web';

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(weatherCurrentTool);
  registry.register(listDirTool);
  registry.register(workspaceFilesTool);
  registry.register(workspaceSearchTool);
  registry.register(fileReadTool);
  registry.register(fileReadManyTool);
  registry.register(fileWriteTool);
  registry.register(shellExecTool);
  registry.register(webSearchTool);
  registry.register(webOpenTool);
  registry.register(browserOpenTool);
  registry.register(webResearchTool);
  registry.register(webFetchTool);
  registry.register(planUpdateTool);
  registry.register(askUserQuestionTool);
  registry.register(contextCompactTool);
  registry.register(artifactRecordTool);
  registry.register(applyPatchTool);
  return registry;
}
