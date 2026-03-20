#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const workerDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(workerDir, '..', '..', '..');
const serverDir = path.join(repoRoot, 'server');
const devVarsPath = path.join(workerDir, '.dev.vars');
const devVarsExamplePath = path.join(workerDir, '.dev.vars.example');
const wranglerConfigPath = path.join(workerDir, 'wrangler.jsonc');
const candidateSecretFiles = [
  path.join(serverDir, '.env'),
  path.join(repoRoot, '.env'),
];

function fail(message) {
  console.error(`\n[allmail-edge deploy] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: workerDir,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });

  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} exited with code ${result.status}`);
  }
}

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: workerDir,
    encoding: 'utf8',
    env: process.env,
    ...options,
  });

  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} exited with code ${result.status}`);
  }

  return result.stdout.trim();
}

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
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    entries.set(key, value);
  }
  return entries;
}

function loadSecretFromEnvFiles() {
  for (const envFile of candidateSecretFiles) {
    if (!existsSync(envFile)) {
      continue;
    }
    const entries = parseEnvFile(readFileSync(envFile, 'utf8'));
    const secret = entries.get('INGRESS_SIGNING_SECRET');
    if (secret) {
      return secret;
    }
  }
  return undefined;
}

function validateDevVars(entries) {
  const required = ['INGRESS_URL', 'INGRESS_KEY_ID', 'INGRESS_PROVIDER', 'RAW_EMAIL_OBJECT_PREFIX', 'RAW_EMAIL_BUCKET_NAME'];
  for (const key of required) {
    if (!entries.get(key)) {
      fail(`Missing ${key} in ${path.basename(devVarsPath)}.`);
    }
  }
}

function requireWranglerTemplate() {
  if (!existsSync(wranglerConfigPath)) {
    fail('wrangler.jsonc not found.');
  }
  const raw = readFileSync(wranglerConfigPath, 'utf8');
  for (const marker of ['INGRESS_URL', 'INGRESS_KEY_ID', 'RAW_EMAIL_OBJECT_PREFIX', 'mail-eml']) {
    if (!raw.includes(marker)) {
      fail(`wrangler.jsonc is missing expected marker ${marker}.`);
    }
  }
  return raw;
}

function parseWorkersSubdomain(rawWhoAmI) {
  const candidate = rawWhoAmI.split(/\r?\n/).find((line) => line.toLowerCase().includes('workers.dev subdomain'));
  if (!candidate) {
    return null;
  }
  const segments = candidate.split('│').map((segment) => segment.trim()).filter(Boolean);
  return segments.at(-1) || null;
}

async function promptSecret() {
  const rl = readline.createInterface({ input, output });
  try {
    const secret = await rl.question('Enter INGRESS_SIGNING_SECRET (must match server env): ');
    if (!secret.trim()) {
      fail('INGRESS_SIGNING_SECRET cannot be empty.');
    }
    return secret.trim();
  } finally {
    rl.close();
  }
}

async function resolveIngressSecret() {
  const fromProcess = process.env.INGRESS_SIGNING_SECRET?.trim();
  if (fromProcess) {
    return fromProcess;
  }

  const fromFiles = loadSecretFromEnvFiles()?.trim();
  if (fromFiles) {
    return fromFiles;
  }

  return promptSecret();
}

function requireCloudflareApiToken() {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) {
    fail('CLOUDFLARE_API_TOKEN is required for non-interactive Wrangler deploy/R2 operations. Export it in your shell and retry.');
  }
}

function escapeJsonString(value) {
  return JSON.stringify(value);
}

function buildDeployConfig(template, envEntries) {
  const replacements = {
    '"INGRESS_URL": "https://edge.example.com/ingress/domain-mail/receive"': `"INGRESS_URL": ${escapeJsonString(envEntries.get('INGRESS_URL'))}`,
    '"INGRESS_KEY_ID": "allmail-edge-main"': `"INGRESS_KEY_ID": ${escapeJsonString(envEntries.get('INGRESS_KEY_ID'))}`,
    '"INGRESS_PROVIDER": "CLOUDFLARE_EMAIL_ROUTING"': `"INGRESS_PROVIDER": ${escapeJsonString(envEntries.get('INGRESS_PROVIDER'))}`,
    '"RAW_EMAIL_OBJECT_PREFIX": "allmail-edge/raw"': `"RAW_EMAIL_OBJECT_PREFIX": ${escapeJsonString(envEntries.get('RAW_EMAIL_OBJECT_PREFIX'))}`,
    '"bucket_name": "mail-eml"': `"bucket_name": ${escapeJsonString(envEntries.get('RAW_EMAIL_BUCKET_NAME'))}`,
  };

  let result = template;
  for (const [from, to] of Object.entries(replacements)) {
    if (!result.includes(from)) {
      fail(`Could not find expected template fragment: ${from}`);
    }
    result = result.replace(from, to);
  }
  return result;
}

function writeTemporaryConfig(content) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'allmail-edge-deploy-'));
  const configPath = path.join(tempDir, 'wrangler.deploy.jsonc');
  writeFileSync(configPath, content, 'utf8');
  return { tempDir, configPath };
}

function cleanupTemporaryConfig(tempDir) {
  rmSync(tempDir, { recursive: true, force: true });
}

function buildHealthUrl(workersSubdomain) {
  if (!workersSubdomain) {
    return null;
  }
  return `https://allmail-edge.${workersSubdomain}.workers.dev/health`;
}

function ensureR2BucketExists(bucketName) {
  console.log(`[allmail-edge deploy] Ensuring R2 bucket exists: ${bucketName}`);
  const listOutput = runCapture('npx', ['wrangler', 'r2', 'bucket', 'list']);
  if (listOutput.includes(bucketName)) {
    console.log(`[allmail-edge deploy] R2 bucket already exists: ${bucketName}`);
    return;
  }

  run('npx', ['wrangler', 'r2', 'bucket', 'create', bucketName]);
}

async function main() {
  console.log('\n[allmail-edge deploy] Preparing near one-click Cloudflare deployment...');

  if (!existsSync(devVarsPath)) {
    fail(`Missing ${path.basename(devVarsPath)}. Copy ${path.basename(devVarsExamplePath)} and fill real values first.`);
  }

  const wranglerTemplate = requireWranglerTemplate();
  const devVars = parseEnvFile(readFileSync(devVarsPath, 'utf8'));
  validateDevVars(devVars);

  console.log('[allmail-edge deploy] Checking Wrangler authentication...');
  const whoAmI = runCapture('npx', ['wrangler', 'whoami']);
  console.log(whoAmI);
  const workersSubdomain = parseWorkersSubdomain(whoAmI);

  console.log('[allmail-edge deploy] Running worker quality checks...');
  run('npm', ['run', 'check']);

  console.log('[allmail-edge deploy] Ensuring backend ingress endpoint exists...');
  run('npx', ['tsx', 'scripts/ensure-ingress-endpoint.ts', '--key-id', devVars.get('INGRESS_KEY_ID') || 'allmail-edge-main'], {
    cwd: serverDir,
  });

  requireCloudflareApiToken();
  ensureR2BucketExists(devVars.get('RAW_EMAIL_BUCKET_NAME'));

  const deployConfigContent = buildDeployConfig(wranglerTemplate, devVars);
  const { tempDir, configPath } = writeTemporaryConfig(deployConfigContent);

  try {
    const secret = await resolveIngressSecret();

    console.log('[allmail-edge deploy] Uploading INGRESS_SIGNING_SECRET to Cloudflare...');
    run('npx', ['wrangler', 'secret', 'put', 'INGRESS_SIGNING_SECRET', '--config', configPath], {
      input: `${secret}\n`,
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    console.log('[allmail-edge deploy] Deploying worker with config derived from .dev.vars...');
    run('npx', ['wrangler', 'deploy', '--config', configPath]);

    const healthUrl = buildHealthUrl(workersSubdomain);
    if (healthUrl) {
      console.log(`[allmail-edge deploy] Running post-deploy health check: ${healthUrl}`);
      const curlResult = spawnSync('curl', ['--fail', '--silent', '--show-error', healthUrl], {
        cwd: workerDir,
        encoding: 'utf8',
        env: process.env,
      });
      if (curlResult.status === 0) {
        console.log(curlResult.stdout.trim());
      } else {
        console.warn(`[allmail-edge deploy] Health check could not be confirmed automatically. Check manually: ${healthUrl}`);
      }
    } else {
      console.warn('[allmail-edge deploy] Could not infer workers.dev subdomain from wrangler whoami.');
    }
  } finally {
    cleanupTemporaryConfig(tempDir);
  }

  console.log('\n[allmail-edge deploy] Cloudflare console still requires 3 manual steps:');
  console.log('1. Add / verify the domain in Cloudflare and enable Email Routing.');
  console.log('2. Bind the catch-all or target Email Routing rule to worker: allmail-edge.');
  console.log('3. Ensure Tunnel hostname (for INGRESS_URL) points to the live all-Mail backend.');
  console.log(`\nSee ${path.join(repoRoot, 'CLOUDFLARE-DEPLOY.md')} for the full checklist.`);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
