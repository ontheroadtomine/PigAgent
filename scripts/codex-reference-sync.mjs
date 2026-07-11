#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoUrl = 'https://github.com/openai/codex.git';
const root = process.cwd();
const refDir = join(root, '.nexa-reference');
const repoDir = join(refDir, 'codex');
const lockPath = join(root, 'docs', 'codex-reference-lock.json');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

mkdirSync(refDir, { recursive: true });

if (!existsSync(join(repoDir, '.git'))) {
  run('git', ['clone', '--filter=blob:none', '--depth=1', repoUrl, repoDir], { stdio: 'inherit' });
} else {
  run('git', ['fetch', '--depth=1', 'origin', 'main'], { cwd: repoDir, stdio: 'inherit' });
  run('git', ['checkout', 'origin/main'], { cwd: repoDir, stdio: 'inherit' });
}

const commit = run('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
const files = run('git', ['ls-files'], { cwd: repoDir })
  .split('\n')
  .filter(Boolean)
  .filter(file => /codex-rs\/(core|exec|apply|protocol|mcp)|docs|README|AGENTS/.test(file))
  .slice(0, 600);

const previous = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf-8')) : null;
const lock = {
  repo: repoUrl,
  branch: 'main',
  commit,
  syncedAt: new Date().toISOString(),
  watchedFiles: files,
  previousCommit: previous?.commit || null,
};
writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');

console.log(`Codex reference synced at ${commit}`);
console.log(`Lock written to ${lockPath}`);
