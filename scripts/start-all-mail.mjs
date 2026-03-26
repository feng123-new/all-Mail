import { spawn } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureBootstrapSecrets, parseEnvText } from './bootstrap-secrets.mjs';
import { resolveLoginUrl, usesLocalLoginBaseUrl } from './runtime-access.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const serverDir = path.join(repoRoot, 'server');
const serverDistEntry = path.join(serverDir, 'dist', 'index.js');
const publicIndexFile = path.join(repoRoot, 'public', 'index.html');

async function resolveEnvFile() {
  const candidates = [
    process.env.ALL_MAIL_ENV_FILE,
    path.join(serverDir, '.env'),
    path.join(repoRoot, '.env'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.R_OK);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
}

async function ensureReadable(filePath, guidance) {
  try {
    await access(filePath, fsConstants.R_OK);
  } catch {
    console.error(guidance);
    process.exit(1);
  }
}

async function run(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: options.env ?? process.env,
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        process.stdout.write(text);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        process.stderr.write(text);
      });
    }

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const error = new Error(`${command} ${args.join(' ')} exited with code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        error.code = code;
        reject(error);
      }
    });
  });
}

async function main() {
  await ensureReadable(serverDistEntry, 'server build output is missing. Run `npm run build` at repo root first.');
  await ensureReadable(publicIndexFile, 'public/index.html is missing. Run `npm run build` at repo root first so the frontend is copied into ./public.');

  const envFile = await resolveEnvFile();
  if (!envFile) {
    console.error('No env file found. Create server/.env from server/.env.example, or root .env from .env.example, then retry.');
    process.exit(1);
  }

  const fileEnv = parseEnvText(await readFile(envFile, 'utf8'));
  const normalizedEnv = { ...fileEnv };

  if (!normalizedEnv.PORT && normalizedEnv.APP_PORT) {
    normalizedEnv.PORT = normalizedEnv.APP_PORT;
  }

  if (!normalizedEnv.DATABASE_URL && normalizedEnv.POSTGRES_USER && normalizedEnv.POSTGRES_PASSWORD && normalizedEnv.POSTGRES_DB) {
    const postgresHost = normalizedEnv.POSTGRES_HOST || '127.0.0.1';
    const postgresPort = normalizedEnv.POSTGRES_PORT || normalizedEnv.POSTGRES_INTERNAL_PORT || '5432';
    normalizedEnv.DATABASE_URL = `postgresql://${normalizedEnv.POSTGRES_USER}:${normalizedEnv.POSTGRES_PASSWORD}@${postgresHost}:${postgresPort}/${normalizedEnv.POSTGRES_DB}`;
  }

  if (!normalizedEnv.REDIS_URL && (normalizedEnv.REDIS_PORT || normalizedEnv.REDIS_INTERNAL_PORT)) {
    const redisHost = normalizedEnv.REDIS_HOST || '127.0.0.1';
    const redisPort = normalizedEnv.REDIS_PORT || normalizedEnv.REDIS_INTERNAL_PORT || '6379';
    normalizedEnv.REDIS_URL = `redis://${redisHost}:${redisPort}`;
  }

  const stateDir = process.env.ALL_MAIL_STATE_DIR
    ? path.resolve(process.env.ALL_MAIL_STATE_DIR)
    : path.join(repoRoot, '.all-mail-runtime');
  const bootstrapSecrets = await ensureBootstrapSecrets({ stateDir, env: normalizedEnv });
  Object.assign(normalizedEnv, bootstrapSecrets.secrets);

  const runtimeEnv = {
    ...normalizedEnv,
    ...process.env,
    ALL_MAIL_BOOTSTRAP_SECRETS_FILE: bootstrapSecrets.secretsFile,
    ALL_MAIL_GENERATED_SECRETS: bootstrapSecrets.createdKeys.join(','),
    ALL_MAIL_MANAGED_BOOTSTRAP_SECRETS: bootstrapSecrets.managedKeys.join(','),
  };
  const loginUrl = resolveLoginUrl(runtimeEnv);
  const shouldPrintBootstrapLogin = bootstrapSecrets.createdStateFile || bootstrapSecrets.createdKeys.includes('ADMIN_PASSWORD');

  console.log(`Using env file: ${envFile}`);
  if (bootstrapSecrets.createdKeys.length > 0) {
    console.log(`Generated bootstrap secrets in ${bootstrapSecrets.secretsFile}`);
  }
  if (shouldPrintBootstrapLogin) {
    console.log(`First login URL: ${loginUrl}`);
    if (usesLocalLoginBaseUrl(runtimeEnv)) {
      console.log('NOTE: 127.0.0.1/localhost only works on the same machine. Replace it with your cloud server public IP, domain, or the correct local address when accessing remotely.');
    }
    console.log(`Bootstrap admin username: ${runtimeEnv.ADMIN_USERNAME || 'admin'}`);
    if (runtimeEnv.ADMIN_PASSWORD) {
      const passwordLabel = bootstrapSecrets.createdKeys.includes('ADMIN_PASSWORD')
        ? 'Temporary admin password'
        : 'Bootstrap admin password';
      console.log(`${passwordLabel}: ${runtimeEnv.ADMIN_PASSWORD}`);
    }
    if (bootstrapSecrets.createdKeys.includes('ADMIN_PASSWORD')) {
      console.log('IMPORTANT: This password is shown only once.');
      console.log('You must log in and change it immediately before using the rest of the application.');
      console.log('After the password is changed, this temporary password will no longer be valid.');
    }
  }

  try {
    await run('npm', ['run', 'db:migrate'], { cwd: serverDir, env: runtimeEnv });
  } catch (error) {
    const combinedOutput = `${error.stdout ?? ''}\n${error.stderr ?? ''}`;
    if (!combinedOutput.includes('P3005')) {
      throw error;
    }
    console.log('Prisma migrate deploy skipped for legacy non-empty database; falling back to db push.');
    await run('npm', ['run', 'db:push', '--', '--skip-generate'], { cwd: serverDir, env: runtimeEnv });
  }

  const child = spawn('npm', ['run', 'start'], {
    cwd: serverDir,
    env: runtimeEnv,
    stdio: 'inherit',
  });

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on('SIGINT', forwardSignal);
  process.on('SIGTERM', forwardSignal);

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
