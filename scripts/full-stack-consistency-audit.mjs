import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outputDir = path.join(root, 'audit-output');
await mkdir(outputDir, { recursive: true });

const run = (command, args = [], options = {}) =>
  execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });

const trackedFiles = run('git', ['ls-files', '-z'])
  .split('\0')
  .filter(Boolean)
  .sort();

const findings = [];
const inventories = {
  trackedFiles: trackedFiles.length,
  frontendApiCalls: [],
  backendRouteLiterals: [],
  frontendRoutes: [],
  navigationRoutes: [],
  environment: {},
  pageCoverage: [],
};

function addFinding(severity, category, message, evidence = undefined) {
  findings.push({ severity, category, message, evidence });
}

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

function isProductionSource(file) {
  if (/(_test\.go|\.test\.[cm]?[jt]sx?|\/__tests__\/|\/test\/|\/tests\/|\/e2e\/)/.test(file)) {
    return false;
  }
  return (
    /^core\/.*\.go$/.test(file)
    || /^web\/src\/.*\.[cm]?[jt]sx?$/.test(file)
    || /^cloudflare\/workers\/.*\.[cm]?[jt]s$/.test(file)
    || /^scripts\/.*\.mjs$/.test(file)
  );
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

function collectMatches(source, regex) {
  const matches = [];
  for (const match of source.matchAll(regex)) {
    matches.push(match);
  }
  return matches;
}

function normalizeRoute(route) {
  return route
    .replace(/\\\$\{[^}]+\}/g, ':param')
    .replace(/\{[^}]+\}/g, ':param')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':param')
    .replace(/\?.*$/, '')
    .replace(/\/+$/, '')
    || '/';
}

function routeShape(route) {
  return normalizeRoute(route)
    .split('/')
    .filter(Boolean)
    .map((segment) => (segment === ':param' || segment === '*' ? ':param' : segment));
}

function routesCompatible(frontendRoute, backendRoute) {
  const front = routeShape(frontendRoute);
  const back = routeShape(backendRoute);
  if (front.length !== back.length) return false;
  return front.every((segment, index) => {
    const peer = back[index];
    return segment === peer || segment === ':param' || peer === ':param';
  });
}

function collectEnvironmentNames(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectEnvironmentNames(item, output);
    return output;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (/^[A-Z][A-Z0-9_]+$/.test(key)) output.add(key);
      collectEnvironmentNames(item, output);
    }
    return output;
  }
  if (typeof value === 'string' && /^[A-Z][A-Z0-9_]+$/.test(value)) {
    output.add(value);
  }
  return output;
}

// Repository hygiene and source completeness.
const forbiddenTrackedPatterns = [
  { pattern: /(^|\/)\.env$/, label: 'tracked runtime .env file' },
  { pattern: /(^|\/)node_modules\//, label: 'tracked node_modules content' },
  { pattern: /(^|\/)dist(-ssr)?\//, label: 'tracked build output' },
  { pattern: /(^|\/)coverage\//, label: 'tracked coverage output' },
  { pattern: /(^|\/)\.DS_Store$/, label: 'tracked macOS metadata' },
  { pattern: /(^|\/)(?:tmp|temp)\//i, label: 'tracked temporary directory' },
  { pattern: /\.(?:bak|old|orig|rej|swp|tmp)$/i, label: 'tracked backup or editor file' },
];

for (const file of trackedFiles) {
  for (const rule of forbiddenTrackedPatterns) {
    if (rule.pattern.test(file) && file !== '.env.example') {
      addFinding('error', 'repository-hygiene', rule.label, file);
    }
  }
  const metadata = await stat(path.join(root, file));
  if (metadata.size > 5 * 1024 * 1024) {
    addFinding('warning', 'repository-hygiene', 'tracked file exceeds 5 MiB', {
      file,
      bytes: metadata.size,
    });
  }
}

const debugPatterns = [
  { regex: /\bdebugger\s*;/g, message: 'debugger statement remains in production source' },
  { regex: /\bconsole\.(?:log|debug|trace)\s*\(/g, message: 'console debugging remains in production source' },
  { regex: /(?:TODO|FIXME|XXX|HACK)(?:\([^)]*\))?\s*:/gi, message: 'unfinished-work marker remains in production source' },
  { regex: /(?:not implemented|not yet implemented|unimplemented)/gi, message: 'not-implemented path remains in production source' },
  { regex: /http\.StatusNotImplemented|\b501\b/g, message: 'HTTP 501 path remains in production source' },
  { regex: /panic\(\s*["'`](?:TODO|FIXME|not implemented)/gi, message: 'placeholder panic remains in production source' },
];

for (const file of trackedFiles.filter(isProductionSource)) {
  const source = await read(file);
  if (/^(?:<{7}|={7}|>{7})/m.test(source)) {
    addFinding('error', 'repository-hygiene', 'unresolved merge marker', file);
  }
  for (const rule of debugPatterns) {
    const matches = collectMatches(source, rule.regex);
    for (const match of matches.slice(0, 10)) {
      addFinding(
        rule.message.includes('unfinished') || rule.message.includes('not-implemented') || rule.message.includes('501')
          ? 'warning'
          : 'error',
        'source-completeness',
        rule.message,
        `${file}:${lineNumber(source, match.index ?? 0)}`,
      );
    }
  }
}

// Canonical release identity.
const version = (await read('VERSION')).trim();
const rootPackage = JSON.parse(await read('package.json'));
const changelog = await read('CHANGELOG.md');
const readme = await read('README.md');
assert.match(version, /^\d+\.\d+\.\d+$/);
if (rootPackage.version !== version) {
  addFinding('error', 'version-identity', 'VERSION and root package.json disagree', {
    version,
    packageVersion: rootPackage.version,
  });
}
if (!changelog.includes(`## [${version}]`)) {
  addFinding('error', 'version-identity', 'CHANGELOG has no section for VERSION', version);
}
if (!readme.includes(`v${version}`)) {
  addFinding('warning', 'version-identity', 'README does not mention the current stable version', version);
}

// Environment inventory and drift checks.
const envExample = await read('.env.example');
const envExampleKeys = new Set(
  envExample
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter(Boolean),
);

let runtimeManifest = {};
try {
  runtimeManifest = JSON.parse(await read('config/runtime-env.json'));
} catch (error) {
  addFinding('error', 'environment-contract', 'config/runtime-env.json is missing or invalid JSON', String(error));
}
const manifestKeys = collectEnvironmentNames(runtimeManifest);

const composeSource = await read('docker-compose.yml');
const composeInterpolationKeys = new Set(
  collectMatches(composeSource, /\$\{([A-Z][A-Z0-9_]*)/g).map((match) => match[1]),
);

let composeModel = {};
const composeJsonPath = process.env.ALLMAIL_AUDIT_COMPOSE_JSON;
if (composeJsonPath) {
  try {
    composeModel = JSON.parse(await readFile(composeJsonPath, 'utf8'));
  } catch (error) {
    addFinding('error', 'compose-contract', 'resolved Compose JSON is missing or invalid', String(error));
  }
}

const composeServiceEnvironmentKeys = new Set();
for (const service of Object.values(composeModel.services ?? {})) {
  for (const key of Object.keys(service.environment ?? {})) {
    composeServiceEnvironmentKeys.add(key);
  }
}

const processEnvironmentKeys = new Set();
for (const file of trackedFiles.filter((item) => /\.(?:go|mjs|cjs|js|ts|tsx|sh)$/.test(item))) {
  const source = await read(file);
  for (const match of source.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[['"]([A-Z][A-Z0-9_]*)['"]\])/g)) {
    processEnvironmentKeys.add(match[1] ?? match[2]);
  }
  for (const match of source.matchAll(/(?:os\.(?:Getenv|LookupEnv)|(?:must|required|optional)?Env(?:String|Bool|Int|Duration)?|getenv)\s*\(\s*["'`]([A-Z][A-Z0-9_]*)["'`]/gi)) {
    processEnvironmentKeys.add(match[1]);
  }
}

const knownInternalEnvironment = new Set([
  'ALL_MAIL_VERSION',
  'ALL_MAIL_COMMIT',
  'ALL_MAIL_BUILD_DATE',
  'CI',
  'GITHUB_ACTIONS',
  'GITHUB_EVENT_NAME',
  'GITHUB_HEAD_REF',
  'GITHUB_REF',
  'GITHUB_REPOSITORY',
  'GITHUB_SHA',
  'GITHUB_WORKSPACE',
  'HOME',
  'HOSTNAME',
  'NODE_OPTIONS',
  'PATH',
  'PWD',
  'RUNNER_TEMP',
  'TEMP',
  'TMP',
  'TMPDIR',
  'USER',
]);

for (const key of composeInterpolationKeys) {
  if (!envExampleKeys.has(key) && !knownInternalEnvironment.has(key)) {
    addFinding('warning', 'environment-contract', 'Compose interpolation is not documented in .env.example', key);
  }
}
for (const key of envExampleKeys) {
  if (!manifestKeys.has(key)) {
    addFinding('warning', 'environment-contract', '.env.example key is absent from runtime-env manifest', key);
  }
}
for (const key of composeServiceEnvironmentKeys) {
  if (!manifestKeys.has(key) && !knownInternalEnvironment.has(key)) {
    addFinding('warning', 'environment-contract', 'resolved service environment key is absent from runtime-env manifest', key);
  }
}
for (const key of processEnvironmentKeys) {
  if (!manifestKeys.has(key) && !envExampleKeys.has(key) && !knownInternalEnvironment.has(key)) {
    addFinding('warning', 'environment-contract', 'source reads an environment key outside the canonical manifest/template', key);
  }
}

inventories.environment = {
  envExampleKeys: [...envExampleKeys].sort(),
  manifestKeys: [...manifestKeys].sort(),
  composeInterpolationKeys: [...composeInterpolationKeys].sort(),
  composeServiceEnvironmentKeys: [...composeServiceEnvironmentKeys].sort(),
  processEnvironmentKeys: [...processEnvironmentKeys].sort(),
};

// Compose topology and exposure.
const expectedServices = [
  'app',
  'go-business-api',
  'worker-forwarding',
  'worker-retention',
  'postgres',
  'redis',
].sort();
const actualServices = Object.keys(composeModel.services ?? {}).sort();
if (JSON.stringify(actualServices) !== JSON.stringify(expectedServices)) {
  addFinding('error', 'compose-contract', 'resolved long-running service set drifted', {
    expectedServices,
    actualServices,
  });
}
for (const [serviceName, service] of Object.entries(composeModel.services ?? {})) {
  if (serviceName !== 'app' && Array.isArray(service.ports) && service.ports.length > 0) {
    addFinding('error', 'compose-contract', 'private service publishes a host port', {
      service: serviceName,
      ports: service.ports,
    });
  }
}

// Frontend route and navigation consistency.
const appSources = trackedFiles.filter((file) => /^web\/src\/.*\.[tj]sx?$/.test(file));
for (const file of appSources) {
  const source = await read(file);
  for (const match of source.matchAll(/<Route\b[^>]*\bpath=["']([^"']+)["']/g)) {
    inventories.frontendRoutes.push({ file, line: lineNumber(source, match.index ?? 0), path: match[1] });
  }
  if (/navigation/i.test(file)) {
    for (const match of source.matchAll(/(?:path|to|key)\s*:\s*["'](\/(?!\/)[^"']+)["']/g)) {
      inventories.navigationRoutes.push({ file, line: lineNumber(source, match.index ?? 0), path: match[1] });
    }
  }
}
const frontendRouteStrings = new Set(inventories.frontendRoutes.map((item) => item.path));
for (const item of inventories.navigationRoutes) {
  const leaf = item.path.replace(/^\//, '');
  if (!frontendRouteStrings.has(item.path) && !frontendRouteStrings.has(leaf)) {
    addFinding('warning', 'frontend-routing', 'navigation target has no directly matching React route literal', item);
  }
}

// Frontend API call inventory.
const requestMethodMap = {
  requestGet: 'GET',
  requestPost: 'POST',
  requestPut: 'PUT',
  requestDelete: 'DELETE',
  requestPatch: 'PATCH',
};
for (const file of appSources.filter((item) => /^web\/src\/(?:api|contracts)\//.test(item))) {
  const source = await read(file);
  const routeRegex = /([`'"])(\/(?:admin|api|mail\/api|oauth|ingress)(?:\\.|(?!\1)[\s\S])*?)\1/g;
  for (const match of source.matchAll(routeRegex)) {
    const start = match.index ?? 0;
    const prefix = source.slice(Math.max(0, start - 600), start);
    let method = 'UNKNOWN';
    let nearest = -1;
    for (const [functionName, httpMethod] of Object.entries(requestMethodMap)) {
      const position = prefix.lastIndexOf(functionName);
      if (position > nearest) {
        nearest = position;
        method = httpMethod;
      }
    }
    inventories.frontendApiCalls.push({
      file,
      line: lineNumber(source, start),
      method,
      path: normalizeRoute(match[2]),
      literal: match[2],
    });
  }
}

// Backend route literal inventory. Route registration can compose prefixes, so
// mismatches are warnings unless a route has no compatible literal anywhere.
for (const file of trackedFiles.filter((item) => /^core\/.*\.go$/.test(item) && !item.endsWith('_test.go'))) {
  const source = await read(file);
  const routeRegex = /([`"])(\/(?:admin|api|mail\/api|oauth|ingress)(?:\\.|(?!\1)[\s\S])*?)\1/g;
  for (const match of source.matchAll(routeRegex)) {
    inventories.backendRouteLiterals.push({
      file,
      line: lineNumber(source, match.index ?? 0),
      path: normalizeRoute(match[2]),
      literal: match[2],
    });
  }
}

const uniqueFrontendCalls = [];
const frontendCallKeys = new Set();
for (const call of inventories.frontendApiCalls) {
  const key = `${call.method} ${call.path}`;
  if (!frontendCallKeys.has(key)) {
    frontendCallKeys.add(key);
    uniqueFrontendCalls.push(call);
  }
}
for (const call of uniqueFrontendCalls) {
  if (!inventories.backendRouteLiterals.some((route) => routesCompatible(call.path, route.path))) {
    addFinding('warning', 'frontend-backend-contract', 'frontend API call has no compatible Go route literal', call);
  }
}

// Page-level test visibility. Route-level tests can still cover a page, so gaps
// are warnings for review rather than blockers.
const routeTestCorpus = (
  await Promise.all(
    trackedFiles
      .filter((file) => /^web\/src\/.*(?:\.test\.[tj]sx?|\/__tests__\/.*\.[tj]sx?)$/.test(file))
      .map((file) => read(file)),
  )
).join('\n');
for (const file of trackedFiles.filter((item) => /^web\/src\/pages\/.*\/index\.tsx$/.test(item))) {
  const directory = path.posix.dirname(file);
  const localTests = trackedFiles.filter((item) => item.startsWith(`${directory}/`) && /(?:\.test\.[tj]sx?|\/__tests__\/)/.test(item));
  const routeHint = `/${directory.split('/').slice(3).join('/')}`;
  const coveredByRouteTest = routeTestCorpus.includes(routeHint);
  inventories.pageCoverage.push({ file, localTests, coveredByRouteTest });
  if (localTests.length === 0 && !coveredByRouteTest) {
    addFinding('warning', 'feature-coverage', 'page has no local or obvious route-level test reference', file);
  }
}

// Secret-like tracked content. These are deliberately high-confidence patterns.
const secretPatterns = [
  { regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, label: 'private key material' },
  { regex: /\bAKIA[0-9A-Z]{16}\b/, label: 'AWS access key identifier' },
  { regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, label: 'GitHub token' },
  { regex: /\bsk-[A-Za-z0-9_-]{32,}\b/, label: 'API secret token' },
];
for (const file of trackedFiles.filter((item) => !/package-lock\.json$|go\.sum$|\.md$/.test(item))) {
  const source = await read(file);
  for (const rule of secretPatterns) {
    if (rule.regex.test(source)) {
      addFinding('error', 'secret-hygiene', `tracked ${rule.label} detected`, file);
    }
  }
}

// Summaries.
const severityRank = { error: 0, warning: 1, info: 2 };
findings.sort((a, b) => {
  const rank = severityRank[a.severity] - severityRank[b.severity];
  if (rank !== 0) return rank;
  return `${a.category}:${a.message}`.localeCompare(`${b.category}:${b.message}`);
});

const summary = {
  version,
  commit: run('git', ['rev-parse', 'HEAD']).trim(),
  generatedAt: new Date().toISOString(),
  totals: {
    error: findings.filter((item) => item.severity === 'error').length,
    warning: findings.filter((item) => item.severity === 'warning').length,
    info: findings.filter((item) => item.severity === 'info').length,
  },
  findings,
  inventories,
};

await writeFile(
  path.join(outputDir, 'full-stack-consistency-report.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
);

const markdown = [
  '# all-Mail full-stack consistency audit',
  '',
  `- Version: \`${summary.version}\``,
  `- Commit: \`${summary.commit}\``,
  `- Generated: \`${summary.generatedAt}\``,
  `- Errors: **${summary.totals.error}**`,
  `- Warnings: **${summary.totals.warning}**`,
  '',
  '## Findings',
  '',
  ...(findings.length === 0
    ? ['No findings.']
    : findings.map((finding) => {
        const evidence = finding.evidence === undefined
          ? ''
          : ` — \`${typeof finding.evidence === 'string' ? finding.evidence : JSON.stringify(finding.evidence)}\``;
        return `- **${finding.severity.toUpperCase()}** [${finding.category}] ${finding.message}${evidence}`;
      })),
  '',
  '## Inventory summary',
  '',
  `- Tracked files: ${inventories.trackedFiles}`,
  `- Frontend API call literals: ${inventories.frontendApiCalls.length}`,
  `- Go route literals: ${inventories.backendRouteLiterals.length}`,
  `- React route literals: ${inventories.frontendRoutes.length}`,
  `- Navigation route literals: ${inventories.navigationRoutes.length}`,
  `- Page entrypoints reviewed: ${inventories.pageCoverage.length}`,
  '',
].join('\n');
await writeFile(path.join(outputDir, 'full-stack-consistency-report.md'), markdown);

console.log(markdown);
if (summary.totals.error > 0) {
  process.exitCode = 1;
}
