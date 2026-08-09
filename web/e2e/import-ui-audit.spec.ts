import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const admin = {
  id: 1,
  username: 'root',
  role: 'SUPER_ADMIN',
  mustChangePassword: false,
  twoFactorEnabled: false,
};

const capabilitySummary = {
  readInbox: true,
  readJunk: true,
  readSent: true,
  clearMailbox: true,
  sendMail: true,
  usesOAuth: true,
  receiveMail: true,
  apiAccess: true,
  forwarding: false,
  search: true,
  refreshToken: true,
  webhook: false,
  aliasSupport: false,
  modes: ['GRAPH', 'IMAP'],
};

const initialRows = [
  {
    id: 1,
    email: 'existing.operator@outlook.com',
    provider: 'OUTLOOK',
    authType: 'MICROSOFT_OAUTH',
    hasStoredPassword: false,
    hasStoredAccountLoginPassword: true,
    capabilitySummary,
    clientId: '00000000-0000-0000-0000-000000000001',
    status: 'ACTIVE',
    groupId: 1,
    group: { id: 1, name: '生产邮箱' },
    lastCheckAt: '2026-08-09T13:58:00.000Z',
    mailboxStatus: null,
    errorMessage: null,
    createdAt: '2026-08-09T13:00:00.000Z',
  },
];

const importedRows = [
  {
    id: 101,
    email: 'audit-hotmail@hotmail.com',
    provider: 'OUTLOOK',
    authType: 'MICROSOFT_OAUTH',
    hasStoredPassword: false,
    hasStoredAccountLoginPassword: true,
    capabilitySummary,
    clientId: '11111111-2222-3333-4444-555555555555',
    status: 'ACTIVE',
    groupId: 2,
    group: { id: 2, name: '真实导入审计' },
    lastCheckAt: null,
    mailboxStatus: null,
    errorMessage: null,
    createdAt: '2026-08-09T14:20:00.000Z',
  },
  {
    id: 102,
    email: 'audit-gmail@gmail.com',
    provider: 'GMAIL',
    authType: 'GOOGLE_OAUTH',
    hasStoredPassword: false,
    hasStoredAccountLoginPassword: true,
    capabilitySummary,
    clientId: 'audit.apps.googleusercontent.com',
    status: 'ACTIVE',
    groupId: 2,
    group: { id: 2, name: '真实导入审计' },
    lastCheckAt: null,
    mailboxStatus: null,
    errorMessage: null,
    createdAt: '2026-08-09T14:20:01.000Z',
  },
  {
    id: 103,
    email: 'audit-qq@qq.com',
    provider: 'QQ',
    authType: 'APP_PASSWORD',
    hasStoredPassword: true,
    hasStoredAccountLoginPassword: true,
    capabilitySummary: { ...capabilitySummary, usesOAuth: false, apiAccess: false, refreshToken: false, modes: ['IMAP', 'SMTP'] },
    clientId: null,
    status: 'ACTIVE',
    groupId: 2,
    group: { id: 2, name: '真实导入审计' },
    lastCheckAt: null,
    mailboxStatus: null,
    errorMessage: null,
    createdAt: '2026-08-09T14:20:02.000Z',
  },
  {
    id: 104,
    email: 'audit-mailcom@mail.com',
    provider: 'MAILCOM',
    authType: 'APP_PASSWORD',
    hasStoredPassword: true,
    hasStoredAccountLoginPassword: true,
    capabilitySummary: { ...capabilitySummary, usesOAuth: false, apiAccess: false, refreshToken: false, modes: ['IMAP', 'SMTP'] },
    clientId: null,
    status: 'ACTIVE',
    groupId: 2,
    group: { id: 2, name: '真实导入审计' },
    lastCheckAt: null,
    mailboxStatus: null,
    errorMessage: null,
    createdAt: '2026-08-09T14:20:03.000Z',
  },
  {
    id: 105,
    email: 'audit-custom@example.test',
    provider: 'CUSTOM_IMAP_SMTP',
    authType: 'APP_PASSWORD',
    hasStoredPassword: true,
    hasStoredAccountLoginPassword: true,
    capabilitySummary: { ...capabilitySummary, usesOAuth: false, apiAccess: false, refreshToken: false, modes: ['IMAP', 'SMTP'] },
    clientId: null,
    status: 'ACTIVE',
    groupId: 2,
    group: { id: 2, name: '真实导入审计' },
    lastCheckAt: null,
    mailboxStatus: null,
    errorMessage: null,
    createdAt: '2026-08-09T14:20:04.000Z',
  },
];

const realisticImportContent = [
  'audit-hotmail@hotmail.com----hotmail-login-pass----11111111-2222-3333-4444-555555555555----M.audit-refresh-token',
  'GMAIL_OAUTH----audit-gmail@gmail.com----audit.apps.googleusercontent.com----gmail-client-secret----1//audit-refresh-token----gmail-login-pass',
  'QQ_IMAP_SMTP----audit-qq@qq.com----qq-app-password----qq-login-pass',
  'MAILCOM_IMAP_SMTP----audit-mailcom@mail.com----mailcom-app-password----mailcom-login-pass',
  'CUSTOM_IMAP_SMTP----audit-custom@example.test----custom-app-password----imap.example.test----993----true----smtp.example.test----465----true----INBOX----Spam----Sent----custom-login-pass',
  'not-an-email----bad-password',
  'GMAIL_OAUTH----broken@gmail.com----client-only',
].join('\n');

const oauthProviderStatuses = {
  GMAIL: {
    configured: false,
    redirectUri: null,
    source: 'none',
    clientId: null,
    scopes: null,
    scopeProfile: 'minimal',
    tenant: null,
    hasClientSecret: false,
  },
  OUTLOOK: {
    configured: true,
    redirectUri: 'http://127.0.0.1:5173/admin/oauth/outlook/callback',
    source: 'database',
    clientId: '00000000-0000-0000-0000-000000000001',
    scopes: 'openid profile email offline_access Mail.Read',
    scopeProfile: 'minimal',
    tenant: 'consumers',
    hasClientSecret: true,
  },
};

async function fulfillSuccess(route: Route, data: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data }),
  });
}

async function mockImportControlPlane(page: Page) {
  let imported = false;
  let submittedPayload: unknown = null;

  await page.route('**/admin/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (!pathname.startsWith('/admin/')) {
      await route.continue();
      return;
    }
    if (pathname === '/admin/auth/login') {
      await fulfillSuccess(route, { admin });
      return;
    }
    if (pathname === '/admin/auth/me') {
      await fulfillSuccess(route, admin);
      return;
    }
    if (pathname === '/admin/emails/import' && request.method() === 'POST') {
      submittedPayload = request.postDataJSON();
      imported = true;
      await fulfillSuccess(route, {
        success: 5,
        failed: 2,
        errors: [
          'line 6: email is invalid',
          'line 7: tokenized OAuth import is missing required fields',
        ],
      });
      return;
    }
    if (pathname === '/admin/emails/stats') {
      const rows = imported ? [...importedRows, ...initialRows] : initialRows;
      await fulfillSuccess(route, {
        total: rows.length,
        active: rows.length,
        error: 0,
        providers: rows.reduce<Record<string, number>>((summary, row) => {
          summary[row.provider] = (summary[row.provider] ?? 0) + 1;
          return summary;
        }, {}),
      });
      return;
    }
    if (pathname === '/admin/emails') {
      const rows = imported ? [...importedRows, ...initialRows] : initialRows;
      await fulfillSuccess(route, { list: rows, total: rows.length });
      return;
    }
    if (pathname === '/admin/email-groups') {
      await fulfillSuccess(route, [
        {
          id: 1,
          name: '生产邮箱',
          description: null,
          fetchStrategy: 'GRAPH_FIRST',
          emailCount: 1,
          createdAt: '2026-08-09T13:00:00.000Z',
          updatedAt: '2026-08-09T13:00:00.000Z',
        },
        {
          id: 2,
          name: '真实导入审计',
          description: '自动化模拟导入使用',
          fetchStrategy: 'IMAP_FIRST',
          emailCount: imported ? 5 : 0,
          createdAt: '2026-08-09T13:30:00.000Z',
          updatedAt: '2026-08-09T13:30:00.000Z',
        },
      ]);
      return;
    }
    if (pathname === '/admin/oauth/providers') {
      await fulfillSuccess(route, oauthProviderStatuses);
      return;
    }
    if (pathname.startsWith('/admin/dashboard/')) {
      await fulfillSuccess(route, pathname.endsWith('/stats') ? {
        apiKeys: { total: 0, active: 0, totalUsage: 0, todayActive: 0 },
        domainMail: { domains: 0, activeDomains: 0, mailboxes: 0, activeMailboxes: 0, inboundMessages: 0, outboundMessages: 0 },
      } : pathname.endsWith('/logs') ? { list: [], total: 0 } : []);
      return;
    }

    await fulfillSuccess(route, {});
  });

  return { getSubmittedPayload: () => submittedPayload };
}

async function loginAsAdministrator(page: Page) {
  await page.goto('/login');
  await page.getByLabel('用户名或邮箱').fill('root');
  await page.getByLabel('密码').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: '进入管理控制台' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function saveAuditScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const project = testInfo.project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const outputDir = path.join(process.cwd(), 'import-audit-shots');
  fs.mkdirSync(outputDir, { recursive: true });
  const body = await page.screenshot({ fullPage: true });
  fs.writeFileSync(path.join(outputDir, `${project}-${name}.png`), body);
  await testInfo.attach(name, { body, contentType: 'image/png' });
}

test('realistic mixed-provider import exposes the current operator experience', async ({ page }, testInfo) => {
  const audit = await mockImportControlPlane(page);
  await loginAsAdministrator(page);
  await page.goto('/emails');
  await expect(page.getByRole('heading', { name: '外部邮箱连接' })).toBeVisible();

  await page.getByRole('button', { name: '工具' }).click();
  const importItem = page.locator('.ant-dropdown-menu-item').filter({ hasText: '导入' }).first();
  await expect(importItem).toBeVisible();
  await importItem.click();

  const modal = page.locator('.ant-modal:visible').first();
  await expect(modal).toBeVisible();
  await expect(modal.locator('textarea')).toBeVisible();
  await saveAuditScreenshot(page, testInfo, 'import-modal-empty');

  await modal.locator('textarea').fill(realisticImportContent);
  const groupSelect = modal.locator('.ant-select').last();
  await groupSelect.click();
  const groupOption = page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: '真实导入审计' }).first();
  await expect(groupOption).toBeVisible();
  await groupOption.click();
  await saveAuditScreenshot(page, testInfo, 'import-modal-filled');

  const submitButton = modal.locator('.ant-modal-footer .ant-btn-primary');
  await expect(submitButton).toBeEnabled();
  await submitButton.click();

  await expect(page.getByText(/导入完成：成功 5 条，失败 2 条/)).toBeVisible();
  await expect(page.getByText('audit-hotmail@hotmail.com')).toBeVisible();
  await expect(page.getByText('audit-mailcom@mail.com')).toBeVisible();
  await saveAuditScreenshot(page, testInfo, 'import-partial-result');

  const payload = audit.getSubmittedPayload() as { content?: string; separator?: string; groupId?: number } | null;
  expect(payload?.content).toBe(realisticImportContent);
  expect(payload?.separator).toBe('----');
  expect(payload?.groupId).toBe(2);
});
