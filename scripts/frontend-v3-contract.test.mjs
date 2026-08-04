import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const frontendV3Components = [
  'DataWorkspace',
  'MailFlowContext',
  'ControlBoundaryContext',
  'PortalWorkspaceContext',
];

test('frontend v3 keeps cookie-first authentication and inbox-first portal routing', async () => {
  const [app, adminLogin, portalLogin, apiCore, authStore, mailboxStore, viteConfig] = await Promise.all([
    read('web/src/App.tsx'),
    read('web/src/pages/login/index.tsx'),
    read('web/src/pages/mail-portal/login/index.tsx'),
    read('web/src/api/core.ts'),
    read('web/src/stores/authStore.ts'),
    read('web/src/stores/mailboxAuthStore.ts'),
    read('web/vite.config.ts'),
  ]);

  assert.ok(
    app.includes('<Route index element={<Navigate to="/mail/inbox" replace />} />'),
    'the authenticated portal index must remain inbox-first',
  );
  assert.ok(
    adminLogin.includes("mustChangePassword ? '/mail/settings' : '/mail/inbox'"),
    'the unified login must send normal portal users to Inbox',
  );
  assert.ok(
    portalLogin.includes("mustChangePassword ? '/mail/settings' : '/mail/inbox'"),
    'the direct portal login must send normal portal users to Inbox',
  );
  assert.match(apiCore, /withCredentials:\s*true/);
  assert.match(viteConfig, /['"]\/mail\/api['"]\s*:/);
  assert.doesNotMatch(
    viteConfig,
    /['"]\/mail['"]\s*:/,
    'the dev proxy must not swallow mailbox-portal SPA routes',
  );

  for (const [name, store] of [
    ['administrator store', authStore],
    ['mailbox store', mailboxStore],
  ]) {
    assert.doesNotMatch(store, /persist\s*\(/, `${name} must not persist authentication state`);
    assert.doesNotMatch(store, /localStorage|sessionStorage/, `${name} must not store credentials in browser storage`);
  }
});

test('frontend v3 keeps explainable dashboard and server-driven OTP behavior', async () => {
  const [dashboard, priorityHero, login] = await Promise.all([
    read('web/src/pages/dashboard/index.tsx'),
    read('web/src/pages/dashboard/DashboardPriorityHero.tsx'),
    read('web/src/pages/login/index.tsx'),
  ]);

  assert.match(dashboard, /DashboardPriorityHero/);
  assert.doesNotMatch(dashboard, /automationHealthScore|healthScoreValue|\/\s*100/);
  assert.match(priorityHero, /attentionCount/);
  assert.match(priorityHero, /abnormalConnections/);
  assert.match(priorityHero, /inactiveDomains/);
  assert.match(priorityHero, /inactiveMailboxes/);

  assert.match(login, /OTP_REQUIRED/);
  assert.doesNotMatch(login, /otpPromptTitle|always-visible|常驻.*2FA/i);
});

test('frontend v3 shared workspaces remain wired into both product shells', async () => {
  const [exports, adminLayout, portalLayout, navigation] = await Promise.all([
    read('web/src/components/index.ts'),
    read('web/src/layouts/MainLayout.tsx'),
    read('web/src/layouts/MailboxLayout.tsx'),
    read('web/src/app/navigation.tsx'),
  ]);

  for (const component of frontendV3Components) {
    assert.match(exports, new RegExp(component));
  }

  assert.match(adminLayout, /WorkspaceFrame kind=\{routeMeta\.workspace\}/);
  assert.match(adminLayout, /MailFlowContext/);
  assert.match(adminLayout, /ControlBoundaryContext/);
  assert.match(portalLayout, /WorkspaceFrame kind="portal"/);
  assert.match(portalLayout, /PortalWorkspaceContext/);

  for (const workspace of ['overview', 'resource', 'flow', 'automation', 'system']) {
    assert.match(navigation, new RegExp(`workspace:\\s*'${workspace}'`));
  }
});

test('frontend v3 enforces responsive, focus-visible, and reduced-motion foundations', async () => {
  const [indexCss, workspaceCss] = await Promise.all([
    read('web/src/index.css'),
    read('web/src/components/DataWorkspace.css'),
  ]);

  assert.match(indexCss, /:focus-visible/);
  assert.match(indexCss, /@media\s*\(max-width:\s*1023px\)/);
  assert.match(indexCss, /@media\s*\(max-width:\s*520px\)/);
  assert.match(indexCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(indexCss, /min-width:\s*320px/);
  assert.match(workspaceCss, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('frontend v3 operational context avoids decorative gradients', async () => {
  const cssFiles = [
    'web/src/components/DataWorkspace.css',
    'web/src/components/MailFlowContext.css',
    'web/src/components/ControlBoundaryContext.css',
    'web/src/components/PortalWorkspaceContext.css',
  ];

  for (const cssFile of cssFiles) {
    const css = await read(cssFile);
    assert.doesNotMatch(css, /(?:linear|radial)-gradient\s*\(/i, `${cssFile} reintroduced a decorative gradient`);
  }
});

test('frontend v3 browser and bundle regression gates are present', async () => {
  const [webPackage, playwrightConfig, browserSpec, budgetScript, bootstrapWorkflow, rootPackage] = await Promise.all([
    read('web/package.json'),
    read('web/playwright.config.ts'),
    read('web/e2e/frontend-v3.spec.ts'),
    read('web/scripts/check-build-budget.mjs'),
    read('.github/workflows/bootstrap-admin-security.yml'),
    read('package.json'),
  ]);

  const webMetadata = JSON.parse(webPackage);
  const rootMetadata = JSON.parse(rootPackage);
  assert.equal(webMetadata.scripts['test:browser'], 'playwright test');
  assert.equal(webMetadata.scripts['check:budget'], 'node ./scripts/check-build-budget.mjs');
  assert.match(playwrightConfig, /Desktop Chromium/);
  assert.match(playwrightConfig, /Mobile Chromium/);
  assert.match(browserSpec, /administrator login reaches the explainable dashboard/);
  assert.match(browserSpec, /portal login reaches the inbox-first workspace/);
  assert.match(bootstrapWorkflow, /Check frontend build budget/);
  assert.match(bootstrapWorkflow, /Install isolated Playwright browser smoke dependency/);
  assert.match(bootstrapWorkflow, /@playwright\/test@1\.55\.0/);
  assert.match(bootstrapWorkflow, /frontend-playwright/);
  assert.match(bootstrapWorkflow, /ln -s .*node_modules\/@playwright/);
  assert.match(bootstrapWorkflow, /Run frontend browser smoke/);
  assert.match(rootMetadata.scripts['verify:release'], /check:budget/);
  assert.match(budgetScript, /largestJavaScript/);
  assert.match(budgetScript, /totalJavaScript/);
  await access(path.join(root, 'web/e2e/frontend-v3.spec.ts'));
});
