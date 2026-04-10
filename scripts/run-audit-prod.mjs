import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeNodeRuntimeEnv } from './runtime-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export const productionAuditSteps = [
  { name: 'server', command: 'npm', args: ['--prefix', 'server', 'audit', '--omit=dev'] },
  { name: 'web', command: 'npm', args: ['--prefix', 'web', 'audit', '--omit=dev'] },
  { name: 'worker', command: 'npm', args: ['--prefix', 'cloudflare/workers/allmail-edge', 'audit', '--omit=dev'] },
];

function stepLabel(step) {
  return `[audit:${step.name}]`;
}

export async function runAuditStep(step, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      cwd: options.cwd ?? repoRoot,
      env: sanitizeNodeRuntimeEnv(options.env ?? process.env),
      stdio: options.stdio ?? 'inherit',
    });

    child.on('error', (error) => {
      resolve({ step, ok: false, code: 1, error });
    });

    child.on('close', (code) => {
      resolve({ step, ok: code === 0, code: code ?? 1 });
    });
  });
}

export async function runProductionAudits(runStep = runAuditStep, steps = productionAuditSteps) {
  const results = [];

  for (const step of steps) {
    console.log(`${stepLabel(step)} starting`);
    const result = await runStep(step);
    results.push(result);
    console.log(`${stepLabel(step)} ${result.ok ? 'passed' : `failed (exit ${result.code})`}`);
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.error(`Production dependency audits failed: ${failed.map((result) => result.step.name).join(', ')}`);
    return { ok: false, results, failed };
  }

  console.log('All production dependency audits passed.');
  return { ok: true, results, failed: [] };
}

async function main() {
  const result = await runProductionAudits();
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
