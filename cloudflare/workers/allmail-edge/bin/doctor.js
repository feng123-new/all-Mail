#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const workerDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(workerDir, '..', '..', '..');
const serverDir = path.join(repoRoot, 'server');
const devVarsPath = path.join(workerDir, '.dev.vars');
const wranglerConfigPath = path.join(workerDir, 'wrangler.jsonc');
const serverEnvPath = path.join(serverDir, '.env');
const rootEnvPath = path.join(repoRoot, '.env');
const postDeploy = process.argv.includes('--postdeploy');

function parseEnvFile(content) {
  const entries = new Map();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    entries.set(line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim());
  }
  return entries;
}

function runCapture(command, args, cwd = workerDir) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: process.env,
  });

  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() || '',
    stderr: result.stderr?.trim() || '',
    status: result.status,
    error: result.error?.message || null,
  };
}

function deriveIngressHealthUrl(ingressUrl) {
  const url = new URL(ingressUrl);
  url.pathname = '/health';
  url.search = '';
  url.hash = '';
  return url.toString();
}

function parseWorkersSubdomain(rawWhoAmI) {
  const candidate = rawWhoAmI.split(/\r?\n/).find((line) => line.toLowerCase().includes('workers.dev subdomain'));
  if (!candidate) {
    return null;
  }
  const segments = candidate.split('│').map((segment) => segment.trim()).filter(Boolean);
  return segments.at(-1) || null;
}

function logResult(status, title, detail) {
  const icon = status === 'pass' ? '✅' : status === 'skip' ? '⏭️' : '❌';
  console.log(`${icon} ${title}`);
  if (detail) {
    console.log(`   ${detail}`);
  }
}

function isPlaceholderSecret(value) {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('replace-with-');
}

function main() {
  const failures = [];

  if (!existsSync(devVarsPath)) {
    failures.push(`${devVarsPath} is missing`);
    logResult('fail', 'Local worker config', `Missing ${devVarsPath}`);
  } else {
    logResult('pass', 'Local worker config', '.dev.vars exists');
  }

  if (!existsSync(wranglerConfigPath)) {
    failures.push(`${wranglerConfigPath} is missing`);
    logResult('fail', 'Wrangler config', `Missing ${wranglerConfigPath}`);
  } else {
    logResult('pass', 'Wrangler config', 'wrangler.jsonc exists');
  }

  if (failures.length > 0) {
    process.exit(1);
  }

  const envEntries = parseEnvFile(readFileSync(devVarsPath, 'utf8'));
  const requiredKeys = ['INGRESS_URL', 'INGRESS_KEY_ID', 'INGRESS_PROVIDER', 'RAW_EMAIL_OBJECT_PREFIX', 'RAW_EMAIL_BUCKET_NAME'];
  const missingKeys = requiredKeys.filter((key) => !envEntries.get(key));
  if (missingKeys.length > 0) {
    failures.push(`Missing keys in .dev.vars: ${missingKeys.join(', ')}`);
    logResult('fail', 'Worker env keys', `Missing ${missingKeys.join(', ')}`);
  } else {
    logResult('pass', 'Worker env keys', requiredKeys.join(', '));
  }

  const ingressSigningSecret = envEntries.get('INGRESS_SIGNING_SECRET');
  if (!ingressSigningSecret) {
    failures.push('INGRESS_SIGNING_SECRET is missing in .dev.vars');
    logResult('fail', 'Worker ingress secret', 'Missing INGRESS_SIGNING_SECRET');
  } else if (isPlaceholderSecret(ingressSigningSecret)) {
    failures.push('INGRESS_SIGNING_SECRET still uses the shipped placeholder');
    logResult('fail', 'Worker ingress secret', 'Replace the shipped placeholder with the real backend shared secret');
  } else {
    logResult('pass', 'Worker ingress secret', 'INGRESS_SIGNING_SECRET is set to a non-placeholder value');
  }

  const whoAmI = runCapture('npx', ['wrangler', 'whoami']);
  if (!whoAmI.ok) {
    failures.push('wrangler whoami failed');
    logResult('fail', 'Wrangler auth', whoAmI.stderr || whoAmI.error || 'Unknown error');
  } else {
    logResult('pass', 'Wrangler auth', 'wrangler whoami succeeded');
  }

  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!apiToken) {
    failures.push('CLOUDFLARE_API_TOKEN is missing');
    logResult('fail', 'Cloudflare API token', 'Export CLOUDFLARE_API_TOKEN before running Wrangler R2/deploy checks in non-interactive environments');
  } else {
    logResult('pass', 'Cloudflare API token', 'CLOUDFLARE_API_TOKEN is present');
  }

  const bucketName = envEntries.get('RAW_EMAIL_BUCKET_NAME');
  if (whoAmI.ok && bucketName && apiToken) {
    const buckets = runCapture('npx', ['wrangler', 'r2', 'bucket', 'list']);
    if (buckets.ok && buckets.stdout.includes(bucketName)) {
      logResult('pass', 'R2 bucket', `${bucketName} exists`);
    } else {
      failures.push(`R2 bucket ${bucketName} not found`);
      logResult('fail', 'R2 bucket', buckets.stderr || `${bucketName} not found in wrangler output`);
    }
  } else {
    logResult('skip', 'R2 bucket', 'Skipped because Wrangler auth, API token, or bucket config is unavailable');
  }

  const ingressUrl = envEntries.get('INGRESS_URL');
  if (ingressUrl) {
    const ingressHealthUrl = deriveIngressHealthUrl(ingressUrl);
    const health = runCapture('curl', ['--fail', '--silent', '--show-error', ingressHealthUrl]);
    if (health.ok) {
      logResult('pass', 'Ingress health', ingressHealthUrl);
    } else {
      failures.push(`Ingress health failed: ${ingressHealthUrl}`);
      logResult('fail', 'Ingress health', health.stderr || health.error || ingressHealthUrl);
    }
  }

  if (existsSync(serverEnvPath) || existsSync(rootEnvPath)) {
    const check = runCapture('npx', ['tsx', 'scripts/ensure-ingress-endpoint.ts', '--check', '--key-id', envEntries.get('INGRESS_KEY_ID') || 'allmail-edge-main'], serverDir);
    if (check.ok) {
      logResult('pass', 'Server ingress endpoint', 'ensure-ingress-endpoint --check passed');
    } else {
      failures.push('Server ingress endpoint check failed');
      logResult('fail', 'Server ingress endpoint', check.stderr || check.stdout || 'Check failed');
    }
  } else {
    logResult('skip', 'Server ingress endpoint', `Skipped because neither ${serverEnvPath} nor ${rootEnvPath} exists`);
  }

  if (postDeploy && whoAmI.ok) {
    const subdomain = parseWorkersSubdomain(whoAmI.stdout);
    if (!subdomain) {
      failures.push('Could not infer workers.dev subdomain');
      logResult('fail', 'Worker health', 'Could not infer workers.dev subdomain from wrangler whoami');
    } else {
      const workerHealthUrl = `https://allmail-edge.${subdomain}.workers.dev/health`;
      const health = runCapture('curl', ['--fail', '--silent', '--show-error', workerHealthUrl]);
      if (health.ok) {
        logResult('pass', 'Worker health', workerHealthUrl);
      } else {
        failures.push(`Worker health failed: ${workerHealthUrl}`);
        logResult('fail', 'Worker health', health.stderr || health.error || workerHealthUrl);
      }
    }
  } else if (!postDeploy) {
    logResult('skip', 'Worker health', 'Run npm run doctor -- --postdeploy after deploying the worker');
  }

  if (failures.length > 0) {
    console.error(`\n[allmail-edge doctor] ${failures.length} check(s) failed.`);
    process.exit(1);
  }

  console.log('\n[allmail-edge doctor] All required checks passed.');
}

main();
