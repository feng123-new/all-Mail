import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
  backendRoutes: [],
  frontendRoutes: [],
  navigationRoutes: [],
  routeOwnership: [],
  environment: {},
  pageCoverage: [],
};

function addFinding(severity, category, message, evidence = undefined) {
  findings.push({ severity, category, message, evidence });
}

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

function sorted(values) {
  return [...values].sort();
}

function sameStrings(left, right) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function normalizeRoute(route) {
  return String(route)
    .trim()
    .replace(/\{\$\}/g, '')
    .replace(/\{[^}]+\}/g, ':param')
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':param')
    .replace(/\?.*$/, '')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/';
}

function routeShape(route) {
  return normalizeRoute(route)
    .split('/')
    .filter(Boolean)
    .map((segment) => (segment === ':param' || segment === '*' ? ':param' : segment));
}

function routesCompatible(leftRoute, rightRoute) {
  const left = routeShape(leftRoute);
  const right = routeShape(rightRoute);
  if (left.length !== right.length) return false;
  return left.every((segment, index) => {
    const peer = right[index];
    return segment === peer || segment === ':param' || peer === ':param';
  });
}

function joinRoute(parent, child) {
  if (!child) return normalizeRoute(parent || '/');
  if (child.startsWith('/')) return normalizeRoute(child);
  if (!parent || parent === '/') return normalizeRoute(`/${child}`);
  return normalizeRoute(`${parent}/${child}`);
}

function isTestFile(file) {
  return /(?:_test\.go|\.test\.[cm]?[jt]sx?|\/__tests__\/|\/e2e\/|\/test\/|\/tests\/)/.test(file);
}

function isApplicationSource(file) {
  if (isTestFile(file)) return false;
  return (
    /^core\/.*\.go$/.test(file)
    || /^web\/src\/.*\.[cm]?[jt]sx?$/.test(file)
    || /^cloudflare\/workers\/allmail-edge\/src\/.*\.[cm]?[jt]s$/.test(file)
  );
}

function getPropertyName(node, ts) {
  if (!node?.name) return '';
  if (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) return node.name.text;
  return '';
}

function expressionToString(node, ts) {
  if (!node) return null;
  if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      value += ':param';
      value += span.literal.text;
    }
    return value;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = expressionToString(node.left, ts);
    const right = expressionToString(node.right, ts);
    if (left === null && right === null) return null;
    return `${left ?? ':param'}${right ?? ':param'}`;
  }
  if (ts.isParenthesizedExpression(node)) return expressionToString(node.expression, ts);
  return ':param';
}

// Repository hygiene.
const forbiddenTrackedPatterns = [
  { pattern: /(^|\/)\.env$/, label: 'tracked runtime .env file' },
  { pattern: /(^|\/)node_modules\//, label: 'tracked node_modules content' },
  { pattern: /(^|\/)dist(?:-ssr)?\//, label: 'tracked build output' },
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

// Production completeness markers. Operator CLIs and audit scripts are excluded:
// console output is their supported interface, not browser debugging residue.
for (const file of trackedFiles.filter(isApplicationSource)) {
  const source = await read(file);
  if (/^(?:<{7}|={7}|>{7})/m.test(source)) {
    addFinding('error', 'repository-hygiene', 'unresolved merge marker', file);
  }
  for (const match of source.matchAll(/(?:TODO|FIXME|XXX|HACK)(?:\([^)]*\))?\s*:/gi)) {
    addFinding('error', 'source-completeness', 'unfinished-work marker remains in production source', `${file}:${lineNumber(source, match.index ?? 0)}`);
  }
  for (const match of source.matchAll(/(?:http\.StatusNotImplemented|\bstatus\s*:\s*501\b|panic\(\s*["'`](?:TODO|FIXME|not implemented))/gi)) {
    addFinding('error', 'source-completeness', 'explicit unimplemented production path remains', `${file}:${lineNumber(source, match.index ?? 0)}`);
  }
  if (/^web\/src\//.test(file)) {
    for (const match of source.matchAll(/\bdebugger\s*;|\bconsole\.(?:log|debug|trace)\s*\(/g)) {
      addFinding('error', 'source-completeness', 'browser debugging statement remains', `${file}:${lineNumber(source, match.index ?? 0)}`);
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
  addFinding('error', 'version-identity', 'README does not identify the current stable version', version);
}

// Environment ownership and Compose drift.
const envExample = await read('.env.example');
const envExampleKeys = new Set(
  envExample
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
    .filter(Boolean),
);
const runtimeManifest = JSON.parse(await read('config/runtime-env.json'));
const manifestKeys = new Set(runtimeManifest.variables.map(({ name }) => name));
if (!sameStrings(envExampleKeys, manifestKeys)) {
  addFinding('error', 'environment-contract', '.env.example and config/runtime-env.json disagree', {
    templateOnly: sorted([...envExampleKeys].filter((key) => !manifestKeys.has(key))),
    manifestOnly: sorted([...manifestKeys].filter((key) => !envExampleKeys.has(key))),
  });
}

const composeSource = await read('docker-compose.yml');
const composeInterpolationKeys = new Set(
  [...composeSource.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]),
);
const launchOnlyComposeKeys = new Set([
  'ALL_MAIL_GO_IMAGE',
  'ALL_MAIL_IMAGE_TAG',
  'ALL_MAIL_VERSION',
  'ALL_MAIL_COMMIT',
  'ALL_MAIL_BUILD_DATE',
]);
for (const key of composeInterpolationKeys) {
  if (!envExampleKeys.has(key) && !launchOnlyComposeKeys.has(key)) {
    addFinding('error', 'environment-contract', 'production Compose exposes an undocumented operator interpolation', key);
  }
}

let composeModel = {};
const composeJsonPath = process.env.ALLMAIL_AUDIT_COMPOSE_JSON;
if (!composeJsonPath) {
  addFinding('error', 'compose-contract', 'ALLMAIL_AUDIT_COMPOSE_JSON was not supplied to the scanner');
} else {
  try {
    composeModel = JSON.parse(await readFile(composeJsonPath, 'utf8'));
  } catch (error) {
    addFinding('error', 'compose-contract', 'resolved Compose JSON is missing or invalid', String(error));
  }
}

const expectedServiceEnvironment = {
  app: [
    'PORT', 'ALL_MAIL_STATIC_DIR', 'GO_BUSINESS_API_URL', 'TRUSTED_PROXY_CIDRS',
    'GO_BUSINESS_QUERY_TIMEOUT_SECONDS', 'MAIL_PROVIDER_TIMEOUT_SECONDS',
    'READY_TIMEOUT_SECONDS', 'SHUTDOWN_TIMEOUT_SECONDS',
  ],
  'go-business-api': [
    'ALL_MAIL_RUNTIME_ENV', 'PORT', 'DATABASE_URL_FILE', 'REDIS_URL',
    'REDIS_PASSWORD_FILE', 'JWT_SECRET_FILE', 'ENCRYPTION_KEY_FILE',
    'JWT_EXPIRES_IN', 'ADMIN_LOGIN_MAX_ATTEMPTS', 'ADMIN_LOGIN_LOCK_MINUTES',
    'ADMIN_2FA_WINDOW', 'BOOTSTRAP_ADMIN_SECRET_FILE', 'INGRESS_ALLOWED_SKEW_SECONDS',
    'GO_BUSINESS_QUERY_TIMEOUT_SECONDS', 'MAIL_PROVIDER_TIMEOUT_SECONDS',
    'READY_TIMEOUT_SECONDS', 'SHUTDOWN_TIMEOUT_SECONDS',
  ],
  'worker-forwarding': [
    'ALL_MAIL_STATE_DIR', 'ENCRYPTION_KEY_FILE', 'DATABASE_URL_FILE',
    'FORWARDING_WORKER_INTERVAL_SECONDS', 'FORWARDING_WORKER_BATCH_SIZE',
    'FORWARDING_RUN_TIMEOUT_SECONDS', 'FORWARDING_LEASE_SECONDS',
    'RESEND_API_BASE_URL', 'WORKER_HEARTBEAT_SECONDS',
    'WORKER_HEARTBEAT_MAX_AGE_SECONDS', 'READY_TIMEOUT_SECONDS',
    'SHUTDOWN_TIMEOUT_SECONDS',
  ],
  'worker-retention': [
    'ALL_MAIL_STATE_DIR', 'DATABASE_URL_FILE', 'API_LOG_RETENTION_DAYS',
    'API_LOG_CLEANUP_INTERVAL_MINUTES', 'API_LOG_CLEANUP_RETRY_SECONDS',
    'API_LOG_CLEANUP_TIMEOUT_SECONDS', 'API_LOG_CLEANUP_BATCH_SIZE',
    'API_LOG_CLEANUP_MAX_BATCHES', 'WORKER_HEARTBEAT_SECONDS',
    'WORKER_HEARTBEAT_MAX_AGE_SECONDS', 'READY_TIMEOUT_SECONDS',
    'SHUTDOWN_TIMEOUT_SECONDS',
  ],
  postgres: ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB'],
  redis: [],
};

const expectedServices = Object.keys(expectedServiceEnvironment).sort();
const actualServices = Object.keys(composeModel.services ?? {}).sort();
if (!sameStrings(actualServices, expectedServices)) {
  addFinding('error', 'compose-contract', 'resolved long-running service set drifted', {
    expectedServices,
    actualServices,
  });
}
for (const serviceName of expectedServices) {
  const service = composeModel.services?.[serviceName];
  if (!service) continue;
  const actualEnvironment = Object.keys(service.environment ?? {});
  if (!sameStrings(actualEnvironment, expectedServiceEnvironment[serviceName])) {
    addFinding('error', 'environment-contract', `resolved ${serviceName} environment ownership drifted`, {
      expected: sorted(expectedServiceEnvironment[serviceName]),
      actual: sorted(actualEnvironment),
    });
  }
  if (serviceName !== 'app' && Array.isArray(service.ports) && service.ports.length > 0) {
    addFinding('error', 'compose-contract', 'private service publishes a host port', {
      service: serviceName,
      ports: service.ports,
    });
  }
}
if (composeModel.services?.['worker-forwarding']?.environment?.RESEND_API_BASE_URL !== 'https://api.resend.com') {
  addFinding('error', 'environment-contract', 'production forwarding endpoint is not the canonical fixed Resend URL', composeModel.services?.['worker-forwarding']?.environment?.RESEND_API_BASE_URL);
}

const knownInternalGoEnvironment = new Set([
  ...Object.values(expectedServiceEnvironment).flat(),
  'DATABASE_URL',
  'ALL_MAIL_MIGRATION_DIR',
  'ALL_MAIL_EXPORT_ENCRYPTION_KEY_FILE',
  'ALL_MAIL_EXPORT_JWT_SECRET_FILE',
  'ALL_MAIL_EXPORT_REDIS_PASSWORD_FILE',
  'ALL_MAIL_EXPORT_API_DATABASE_URL_FILE',
  'ALL_MAIL_EXPORT_FORWARDING_DATABASE_URL_FILE',
  'ALL_MAIL_EXPORT_RETENTION_DATABASE_URL_FILE',
]);
const productionGoEnvironment = new Set();
for (const file of trackedFiles.filter((item) => /^core\/.*\.go$/.test(item) && !item.endsWith('_test.go'))) {
  const source = await read(file);
  for (const match of source.matchAll(/(?:os\.(?:Getenv|LookupEnv)|\benv(?:Int)?|\bgetenv)\s*\(\s*["'`]([A-Z][A-Z0-9_]*)["'`]/g)) {
    productionGoEnvironment.add(match[1]);
  }
}
for (const key of productionGoEnvironment) {
  if (!envExampleKeys.has(key) && !knownInternalGoEnvironment.has(key)) {
    addFinding('error', 'environment-contract', 'Go runtime reads an environment key outside the canonical operator/internal ownership sets', key);
  }
}

inventories.environment = {
  operatorKeys: sorted(envExampleKeys),
  composeInterpolationKeys: sorted(composeInterpolationKeys),
  launchOnlyComposeKeys: sorted(launchOnlyComposeKeys),
  productionGoEnvironment: sorted(productionGoEnvironment),
  serviceEnvironment: Object.fromEntries(
    Object.entries(composeModel.services ?? {}).map(([name, service]) => [name, sorted(Object.keys(service.environment ?? {}))]),
  ),
};

// Load TypeScript only after the exact frontend dependency tree has been installed.
let ts;
try {
  const tsModule = await import(pathToFileURL(path.join(root, 'web/node_modules/typescript/lib/typescript.js')).href);
  ts = tsModule.default ?? tsModule;
} catch (error) {
  addFinding('error', 'frontend-contract', 'TypeScript compiler API is unavailable; run npm --prefix web ci before the scan', String(error));
}

if (ts) {
  const parseTS = async (file) => {
    const source = await read(file);
    return {
      source,
      sourceFile: ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    };
  };

  // React route tree and navigation targets.
  const appFile = 'web/src/App.tsx';
  const { source: appSource, sourceFile: appAST } = await parseTS(appFile);
  const collectReactRoutes = (node, parentRoute = '') => {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    let nextParent = parentRoute;
    if (opening && opening.tagName.getText(appAST) === 'Route') {
      const pathAttribute = opening.attributes.properties.find(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === 'path',
      );
      if (pathAttribute && ts.isJsxAttribute(pathAttribute)) {
        let route = null;
        const initializer = pathAttribute.initializer;
        if (initializer && ts.isStringLiteral(initializer)) route = initializer.text;
        if (initializer && ts.isJsxExpression(initializer)) route = expressionToString(initializer.expression, ts);
        if (route && route !== '*') {
          const fullPath = joinRoute(parentRoute, route);
          inventories.frontendRoutes.push({
            file: appFile,
            line: appAST.getLineAndCharacterOfPosition(opening.getStart(appAST)).line + 1,
            path: fullPath,
          });
          nextParent = fullPath;
        }
      }
    }
    ts.forEachChild(node, (child) => collectReactRoutes(child, nextParent));
  };
  collectReactRoutes(appAST);

  const navigationFile = 'web/src/app/navigation.tsx';
  const { sourceFile: navigationAST } = await parseTS(navigationFile);
  const visitNavigation = (node) => {
    if (ts.isPropertyAssignment(node) && getPropertyName(node, ts) === 'key') {
      const value = expressionToString(node.initializer, ts);
      if (value?.startsWith('/')) {
        inventories.navigationRoutes.push({
          file: navigationFile,
          line: navigationAST.getLineAndCharacterOfPosition(node.getStart(navigationAST)).line + 1,
          path: normalizeRoute(value),
        });
      }
    }
    ts.forEachChild(node, visitNavigation);
  };
  visitNavigation(navigationAST);

  const frontendRouteSet = new Set(inventories.frontendRoutes.map(({ path: route }) => normalizeRoute(route)));
  for (const navigationRoute of inventories.navigationRoutes) {
    if (!frontendRouteSet.has(normalizeRoute(navigationRoute.path))) {
      addFinding('error', 'frontend-routing', 'navigation target has no matching React route', navigationRoute);
    }
  }

  // Actual frontend request-helper calls, excluding tests and request implementation internals.
  const requestMethods = new Map([
    ['requestGet', 'GET'],
    ['requestPost', 'POST'],
    ['requestPut', 'PUT'],
    ['requestPatch', 'PATCH'],
    ['requestDelete', 'DELETE'],
  ]);
  const axiosMethods = new Map([
    ['get', 'GET'],
    ['post', 'POST'],
    ['put', 'PUT'],
    ['patch', 'PATCH'],
    ['delete', 'DELETE'],
  ]);
  const frontendContractFiles = trackedFiles.filter((file) =>
    /^web\/src\/(?:api|contracts)\/.*\.[tj]sx?$/.test(file)
    && !isTestFile(file)
    && file !== 'web/src/api/core.ts',
  );

  for (const file of frontendContractFiles) {
    const { sourceFile } = await parseTS(file);
    const visit = (node) => {
      if (ts.isCallExpression(node) && node.arguments.length > 0) {
        let method = null;
        if (ts.isIdentifier(node.expression)) {
          method = requestMethods.get(node.expression.text) ?? null;
        } else if (
          ts.isPropertyAccessExpression(node.expression)
          && ts.isIdentifier(node.expression.expression)
          && node.expression.expression.text === 'api'
        ) {
          method = axiosMethods.get(node.expression.name.text) ?? null;
        }
        if (method) {
          const rawRoute = expressionToString(node.arguments[0], ts);
          if (rawRoute?.startsWith('/')) {
            inventories.frontendApiCalls.push({
              file,
              line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
              method,
              path: normalizeRoute(rawRoute),
              literal: rawRoute,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
}

// Go ServeMux method-aware routes.
for (const file of trackedFiles.filter((item) => /^core\/.*\.go$/.test(item) && !item.endsWith('_test.go'))) {
  const source = await read(file);
  for (const match of source.matchAll(/\.(?:HandleFunc|Handle)\(\s*["`]([A-Z]+)\s+(\/[^"`]+)["`]/g)) {
    inventories.backendRoutes.push({
      file,
      line: lineNumber(source, match.index ?? 0),
      method: match[1],
      path: normalizeRoute(match[2]),
      literal: match[2],
    });
  }
}

const ownershipManifest = JSON.parse(await read('config/route-ownership.json'));
inventories.routeOwnership = ownershipManifest.routes;

function ownershipMatches(call, route) {
  const methods = route.methods ?? [];
  if (methods.length > 0 && !methods.includes(call.method) && !(call.method === 'GET' && methods.includes('HEAD'))) {
    return false;
  }
  if (route.match === 'exact') return normalizeRoute(call.path) === normalizeRoute(route.path);
  if (route.match === 'prefix') {
    const prefix = normalizeRoute(route.path);
    return normalizeRoute(call.path) === prefix || normalizeRoute(call.path).startsWith(`${prefix}/`);
  }
  return false;
}

const uniqueFrontendCalls = [];
const seenFrontendCalls = new Set();
for (const call of inventories.frontendApiCalls) {
  const key = `${call.method} ${call.path}`;
  if (!seenFrontendCalls.has(key)) {
    seenFrontendCalls.add(key);
    uniqueFrontendCalls.push(call);
  }
}
for (const call of uniqueFrontendCalls) {
  const matchingHandler = inventories.backendRoutes.some(
    (route) => route.method === call.method && routesCompatible(call.path, route.path),
  );
  if (!matchingHandler) {
    addFinding('error', 'frontend-backend-contract', 'frontend request has no matching Go method/path handler', call);
  }
  const owned = ownershipManifest.routes.some(
    (route) => route.owner === 'go-business-api' && ownershipMatches(call, route),
  );
  if (!owned) {
    addFinding('error', 'route-ownership', 'frontend request is absent from the canonical Go business route ownership contract', call);
  }
}

// Page-level regression visibility.
const routeTestCorpus = (
  await Promise.all(
    trackedFiles
      .filter((file) => /^web\/src\/.*(?:\.test\.[tj]sx?|\/__tests__\/.*\.[tj]sx?)$/.test(file))
      .map((file) => read(file)),
  )
).join('\n');
for (const file of trackedFiles.filter((item) => /^web\/src\/pages\/.*\/index\.tsx$/.test(item))) {
  const directory = path.posix.dirname(file);
  const localTests = trackedFiles.filter(
    (item) => item.startsWith(`${directory}/`) && /(?:\.test\.[tj]sx?|\/__tests__\/)/.test(item),
  );
  const pageName = directory.split('/').at(-1);
  const coveredByRouteTest = pageName ? routeTestCorpus.includes(pageName) : false;
  inventories.pageCoverage.push({ file, localTests, coveredByRouteTest });
  if (localTests.length === 0 && !coveredByRouteTest) {
    addFinding('warning', 'feature-coverage', 'page has no local or obvious route-level regression reference', file);
  }
}

const severityRank = { error: 0, warning: 1, info: 2 };
findings.sort((left, right) => {
  const rank = severityRank[left.severity] - severityRank[right.severity];
  if (rank !== 0) return rank;
  return `${left.category}:${left.message}`.localeCompare(`${right.category}:${right.message}`);
});

const summary = {
  version,
  commit: run('git', ['rev-parse', 'HEAD']).trim(),
  generatedAt: new Date().toISOString(),
  totals: {
    error: findings.filter(({ severity }) => severity === 'error').length,
    warning: findings.filter(({ severity }) => severity === 'warning').length,
    info: findings.filter(({ severity }) => severity === 'info').length,
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
  `- Frontend API calls: ${inventories.frontendApiCalls.length}`,
  `- Go method/path handlers: ${inventories.backendRoutes.length}`,
  `- React routes: ${inventories.frontendRoutes.length}`,
  `- Navigation routes: ${inventories.navigationRoutes.length}`,
  `- Operator environment keys: ${inventories.environment.operatorKeys?.length ?? 0}`,
  `- Page entrypoints reviewed: ${inventories.pageCoverage.length}`,
  '',
].join('\n');

await writeFile(path.join(outputDir, 'full-stack-consistency-report.md'), markdown);
process.stdout.write(`${markdown}\n`);
if (summary.totals.error > 0) process.exitCode = 1;
