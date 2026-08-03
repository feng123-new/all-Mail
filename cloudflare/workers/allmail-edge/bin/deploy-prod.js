#!/usr/bin/env node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  buildDeployConfig,
  parseEnvFile,
  requireWorkerDeployVars,
  resolveWorkerHealthUrl,
} from './config-utils.js';

const workerDir = path.resolve(import.meta.dirname, '..');
const repoRoot = path.resolve(workerDir, '..', '..', '..');
const devVarsPath = path.join(workerDir, '.dev.vars');
const devVarsExamplePath = path.join(workerDir, '.dev.vars.example');
const wranglerConfigPath = path.join(workerDir, 'wrangler.jsonc');
const candidateSecretFiles = [
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
  try {
    requireWorkerDeployVars(entries);
    resolveWorkerHealthUrl(entries);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function requireWranglerTemplate() {
  if (!existsSync(wranglerConfigPath)) {
    fail('wrangler.jsonc not found.');
  }
  const raw = readFileSync(wranglerConfigPath, 'utf8');
  for (const marker of ['INGRESS_URL', 'INGRESS_KEY_ID', 'RAW_EMAIL_OBJECT_PREFIX', 'MAX_RAW_EMAIL_BYTES', 'mail-eml']) {
    if (!raw.includes(marker)) {
      fail(`wrangler.jsonc is missing expected marker ${marker}.`);
    }
  }
  return raw;
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

function writeTemporaryConfig(content) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'allmail-edge-deploy-'));
  const configPath = path.join(tempDir, 'wrangler.deploy.jsonc');
  writeFileSync(configPath, content, 'utf8');
  return { tempDir, configPath };
}

function cleanupTemporaryConfig(tempDir) {
  rmSync(tempDir, { recursive: true, force: true });
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

  console.log('[allmail-edge deploy] Running worker quality checks...');
  run('npm', ['run', 'check']);

  console.log('[allmail-edge deploy] Backend ingress endpoints are owned by the Go initializer.');
  console.log('[allmail-edge deploy] Run ./scripts/compose-up.sh with the matching INGRESS_IMPORT_KEY_ID before deploying this Worker.');

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

    const healthUrl = resolveWorkerHealthUrl(devVars);
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
      console.warn('[allmail-edge deploy] WORKER_HEALTH_URL is not configured; skipping post-deploy HTTP health check.');
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
