import { spawn } from 'node:child_process';

const command = process.argv.slice(2).join(' ').trim();

if (!command) {
  console.error('Usage: node ./scripts/run-clean-node.mjs "<command>"');
  process.exit(1);
}

const env = { ...process.env };
for (const key of [
  'NODE_USE_ENV_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
]) {
  delete env[key];
}

const disableWarningFlag = '--disable-warning=UNDICI-EHPA';
env.NODE_OPTIONS = env.NODE_OPTIONS
  ? `${disableWarningFlag} ${env.NODE_OPTIONS}`
  : disableWarningFlag;

const child = spawn(command, {
  cwd: process.cwd(),
  env,
  shell: true,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
