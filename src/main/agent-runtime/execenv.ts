import * as path from 'path';
import * as fs from 'fs';

export interface ExecEnv {
  rootDir: string;
  workDir: string;
  outputDir: string;
  logsDir: string;
}

export interface PrepareParams {
  workspacePath: string;
  conversationId: string;
  issueTitle: string;
  issueDescription?: string;
}

export async function prepareEnv(params: PrepareParams): Promise<ExecEnv> {
  const envRoot = path.join(params.workspacePath, '.nexa', 'conversations', params.conversationId);
  const workDir = path.join(envRoot, 'workdir');
  const outputDir = path.join(envRoot, 'output');
  const logsDir = path.join(envRoot, 'logs');

  await fs.promises.mkdir(workDir, { recursive: true });
  await fs.promises.mkdir(outputDir, { recursive: true });
  await fs.promises.mkdir(logsDir, { recursive: true });

  // Write issue context for agents to consume
  const contextMd = `# ${params.issueTitle}\n\n${params.issueDescription || ''}\n`;
  await fs.promises.writeFile(path.join(envRoot, 'issue_context.md'), contextMd);

  return { rootDir: envRoot, workDir, outputDir, logsDir };
}
