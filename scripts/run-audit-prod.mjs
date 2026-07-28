import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeNodeRuntimeEnv } from './runtime-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export const productionAuditSteps = [
  { name: 'server', command: 'npm', args: ['--prefix', 'server', 'audit', '--omit=dev', '--json'] },
  { name: 'web', command: 'npm', args: ['--prefix', 'web', 'audit', '--omit=dev', '--json'] },
  { name: 'worker', command: 'npm', args: ['--prefix', 'cloudflare/workers/allmail-edge', 'audit', '--omit=dev', '--json'] },
];

export const auditAdvisoryAllowlist = {
  'GHSA-QWWW-VCR4-C8H2': {
    packages: ['react-router', 'react-router-dom'],
    expiresOn: '2026-09-30',
    reason: 'The shipped web application is a Vite SPA and does not use React Router unstable RSC APIs. Upgrade to the patched router line remains tracked before this exception expires.',
  },
};

function stepLabel(step) {
  return `[audit:${step.name}]`;
}

function advisoryID(via) {
  if (!via || typeof via !== 'object') {
    return null;
  }
  const candidates = [via.url, via.title, via.name, via.source]
    .filter((value) => typeof value === 'string' || typeof value === 'number')
    .map(String);
  for (const candidate of candidates) {
    const match = candidate.match(/GHSA-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/i);
    if (match) {
      return match[0].toUpperCase();
    }
  }
  return null;
}

function collectAdvisories(name, vulnerabilities, active = new Set(), memo = new Map()) {
  if (memo.has(name)) {
    return memo.get(name);
  }
  if (active.has(name)) {
    return { ids: [], complete: false };
  }
  const vulnerability = vulnerabilities[name];
  if (!vulnerability || !Array.isArray(vulnerability.via) || vulnerability.via.length === 0) {
    return { ids: [], complete: false };
  }

  active.add(name);
  const advisories = [];
  let complete = true;
  for (const via of vulnerability.via) {
    if (typeof via === 'string') {
      const nested = collectAdvisories(via, vulnerabilities, active, memo);
      advisories.push(...nested.ids);
      complete &&= nested.complete;
      continue;
    }
    const id = advisoryID(via);
    if (id) {
      advisories.push(id);
    } else {
      complete = false;
    }
  }
  active.delete(name);
  const result = { ids: [...new Set(advisories)], complete };
  memo.set(name, result);
  return result;
}

function exceptionIsActive(exception, now) {
  const expiry = new Date(`${exception.expiresOn}T23:59:59.999Z`);
  return Number.isFinite(expiry.getTime()) && now.getTime() <= expiry.getTime();
}

export function evaluateAuditReport(report, options = {}) {
  const now = options.now ?? new Date();
  const allowlist = options.allowlist ?? auditAdvisoryAllowlist;
  let invalidReason = null;
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    invalidReason = 'npm audit returned a non-object report';
  } else if (report.error) {
    invalidReason = 'npm audit returned an error response';
  } else if (!report.vulnerabilities || typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities)) {
    invalidReason = 'npm audit report has no vulnerabilities object';
  }
  if (invalidReason) {
    return {
      ok: false,
      allowed: [],
      blocking: [],
      metadata: report?.metadata ?? null,
      invalidReason,
    };
  }

  const vulnerabilities = report.vulnerabilities;
  const allowed = [];
  const blocking = [];

  for (const [packageName, vulnerability] of Object.entries(vulnerabilities)) {
    const advisoryCollection = collectAdvisories(packageName, vulnerabilities);
    const advisoryIds = advisoryCollection.ids;
    const exceptions = advisoryIds.map((id) => ({ id, exception: allowlist[id] }));
    const isAllowed = advisoryCollection.complete && advisoryIds.length > 0 && exceptions.every(({ exception }) => (
      exception
      && Array.isArray(exception.packages)
      && exception.packages.includes(packageName)
      && exceptionIsActive(exception, now)
    ));

    if (isAllowed) {
      allowed.push({ packageName, vulnerability, advisories: exceptions });
    } else {
      blocking.push({
        packageName,
        vulnerability,
        advisoryIds,
        unresolvedAdvisory: !advisoryCollection.complete,
      });
    }
  }

  return {
    ok: blocking.length === 0,
    allowed,
    blocking,
    metadata: report?.metadata ?? null,
    invalidReason: null,
  };
}

function parseAuditReport(stdout) {
  const content = stdout.trim();
  if (!content) {
    return null;
  }
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function printAuditEvaluation(step, evaluation) {
  if (evaluation.invalidReason) {
    console.error(`${stepLabel(step)} invalid audit report: ${evaluation.invalidReason}`);
  }
  for (const item of evaluation.allowed) {
    for (const { id, exception } of item.advisories) {
      console.warn(
        `${stepLabel(step)} temporarily allowed ${id} for ${item.packageName} until ${exception.expiresOn}: ${exception.reason}`,
      );
    }
  }
  if (evaluation.blocking.length > 0) {
    console.error(`${stepLabel(step)} blocking vulnerabilities:`);
    console.error(JSON.stringify({
      vulnerabilities: Object.fromEntries(
        evaluation.blocking.map((item) => [item.packageName, item.vulnerability]),
      ),
      metadata: evaluation.metadata,
    }, null, 2));
  }
}

export async function runAuditStep(step, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      cwd: options.cwd ?? repoRoot,
      env: sanitizeNodeRuntimeEnv(options.env ?? process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      resolve({ step, ok: false, code: 1, error });
    });
    child.on('close', (code) => {
      const report = parseAuditReport(stdout);
      if (!report) {
        if (stdout) {
          process.stdout.write(stdout);
        }
        if (stderr) {
          process.stderr.write(stderr);
        }
        resolve({
          step,
          ok: false,
          code: 1,
          error: new Error('npm audit did not return valid JSON'),
        });
        return;
      }

      const evaluation = evaluateAuditReport(report, options);
      printAuditEvaluation(step, evaluation);
      if (stderr) {
        process.stderr.write(stderr);
      }
      const findingCount = evaluation.allowed.length + evaluation.blocking.length;
      const executionSucceeded = code === 0 || (code === 1 && findingCount > 0);
      const ok = evaluation.ok && executionSucceeded;
      resolve({
        step,
        ok,
        code: ok ? 0 : (code ?? 1),
        evaluation,
        error: executionSucceeded ? null : new Error(`npm audit exited ${code ?? 'without a status'} without vulnerability findings`),
      });
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
