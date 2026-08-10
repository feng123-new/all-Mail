import { expect, test, type Page, type Route, type TestInfo } from '@playwright/test';

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
    createdAt: '2026-08-10T03:00:00.000Z',
  },
  {
    id: 102,
    email: 'audit-qq@qq.com',
    provider: 'QQ',
    authType: 'APP_PASSWORD',
    hasStoredPassword: true,
    hasStoredAccountLoginPassword: false,
    capabilitySummary: {
      ...capabilitySummary,
      usesOAuth: false,
      apiAccess: false,
      refreshToken: false,
      modes: ['IMAP', 'SMTP'],
    },
    clientId: null,
    status: 'ACTIVE',
    groupId: 2,
    group: { id: 2, name: '真实导入审计' },
    lastCheckAt: null,
    mailboxStatus: null,
    errorMessage: null,
    createdAt: '2026-08-10T03:00:01.000Z',
  },
];

const importContent = [
  'audit-hotmail@hotmail.com----mailbox-password----11111111-2222-3333-4444-555555555555----M.audit-refresh-token',
  'QQ_IMAP_SMTP----audit-qq@qq.com----qq-app-password',
  'not-an-email----bad-password',
].join('\n');

async function fulfillSuccess(route: Route, data: unknown) {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data }),
  });
}

async function mockControlPlane(page: Page) {
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
    if (pathname === '/admin/dashboard/stats') {
      await fulfillSuccess(route, {
        apiKeys: { total: 0, active: 0, totalUsage: 0, todayActive: 0 },
        domainMail: {
          domains: 0,
          activeDomains: 0,
          mailboxes: 0,
          activeMailboxes: 0,
          inboundMessages: 0,
          outboundMessages: 0,
        },
      });
      return;
    }
    if (pathname === '/admin/dashboard/api-trend') {
      await fulfillSuccess(route, []);
      return;
    }
    if (pathname === '/admin/dashboard/logs') {
      await fulfillSuccess(route, { list: [], total: 0 });
      return;
    }
    if (pathname === '/admin/emails/import' && request.method() === 'POST') {
      submittedPayload = request.postDataJSON();
      imported = true;
      await fulfillSuccess(route, { success: 2, failed: 0, errors: [] });
      return;
    }
    if (pathname === '/admin/emails/stats') {
      await fulfillSuccess(route, {
        total: imported ? 2 : 0,
        active: imported ? 2 : 0,
        error: 0,
        providers: imported ? { OUTLOOK: 1, QQ: 1 } : {},
      });
      return;
    }
    if (pathname === '/admin/emails') {
      await fulfillSuccess(route, {
        list: imported ? importedRows : [],
        total: imported ? importedRows.length : 0,
      });
      return;
    }
    if (pathname === '/admin/email-groups') {
      await fulfillSuccess(route, [
        {
          id: 2,
          name: '真实导入审计',
          description: '浏览器回归分组',
          fetchStrategy: 'IMAP_FIRST',
          emailCount: imported ? 2 : 0,
          createdAt: '2026-08-10T02:00:00.000Z',
          updatedAt: '2026-08-10T02:00:00.000Z',
        },
      ]);
      return;
    }
    if (pathname === '/admin/oauth/providers') {
      await fulfillSuccess(route, {
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
          configured: false,
          redirectUri: null,
          source: 'none',
          clientId: null,
          scopes: null,
          scopeProfile: 'minimal',
          tenant: null,
          hasClientSecret: false,
        },
      });
      return;
    }

    await fulfillSuccess(route, {});
  });

  return { getSubmittedPayload: () => submittedPayload };
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('用户名或邮箱').fill('root');
  await page.getByLabel('密码').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: '进入管理控制台' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
}

test('mailbox import previews valid rows, skips invalid rows, and keeps mobile actions compact', async ({ page }, testInfo) => {
  const audit = await mockControlPlane(page);
  await login(page);
  await page.goto('/emails');
  await expect(page.getByRole('heading', { name: '外部邮箱连接' })).toBeVisible();

  await page.getByRole('button', { name: '工具' }).click();
  const importItem = page
    .locator('.ant-dropdown-menu-item')
    .filter({ hasText: '导入' })
    .first();
  await expect(importItem).toBeVisible();
  await importItem.click();

  const workflow = page.locator('.mail-import-workflow').filter({ visible: true }).first();
  await expect(workflow).toBeVisible();
  await expect(page.locator('.ant-dropdown:visible')).toHaveCount(0);

  if (testInfo.project.name === 'Mobile Chromium') {
    await expect(page.locator('.mail-import-workflow--mobile')).toBeVisible();
    await expect(page.locator('.ant-drawer:visible')).toBeVisible();
  } else {
    await expect(page.locator('.mail-import-workflow--desktop')).toBeVisible();
  }

  const textarea = workflow.locator('textarea').first();
  await textarea.fill(importContent);
  await attachScreenshot(page, testInfo, 'mailbox-import-input');

  await workflow.getByRole('button', { name: '生成预览' }).click();
  await expect(workflow.getByText('格式预检完成')).toBeVisible();
  await expect(workflow.getByText('第 3 行')).toBeVisible();
  await expect(workflow.getByText('邮箱地址格式无效')).toBeVisible();
  await expect(workflow.getByText('••••••', { exact: false }).first()).toBeVisible();
  await attachScreenshot(page, testInfo, 'mailbox-import-preview');

  await workflow.getByRole('button', { name: '导入 2 个有效邮箱' }).click();
  await expect(workflow.getByText('导入完成，但仍有数据需要处理')).toBeVisible();
  await expect(workflow.getByText(/成功写入 2 条/)).toBeVisible();
  await attachScreenshot(page, testInfo, 'mailbox-import-result');

  const payload = audit.getSubmittedPayload() as {
    content?: string;
    separator?: string;
    groupId?: number;
  } | null;
  expect(payload?.separator).toBe('----');
  expect(payload?.content).toContain('audit-hotmail@hotmail.com');
  expect(payload?.content).toContain('audit-qq@qq.com');
  expect(payload?.content).not.toContain('not-an-email');

  await workflow.getByRole('button', { name: '仅编辑失败行' }).click();
  await expect(workflow.locator('textarea').first()).toHaveValue(
    'not-an-email----bad-password',
  );

  await workflow.getByRole('button', { name: '取消' }).click();
  await expect(page.locator('.mail-import-workflow:visible')).toHaveCount(0);

  if (testInfo.project.name === 'Mobile Chromium') {
    await expect(page.getByRole('button', { name: '更多操作' })).toHaveCount(2);
    await expect(page.getByRole('button', { name: '已发送' })).toHaveCount(0);
  }
});
