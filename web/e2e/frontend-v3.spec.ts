import { expect, test, type Page, type Route } from '@playwright/test';

const admin = {
  id: 1,
  username: 'root',
  role: 'SUPER_ADMIN',
  mustChangePassword: false,
  twoFactorEnabled: false,
};

const mailboxUser = {
  id: 1,
  username: 'portal-user',
  email: 'portal@example.test',
  mustChangePassword: false,
  mailboxIds: [1],
};

const mailboxCapabilitySummary = {
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

const externalMailboxRows = Array.from({ length: 10 }, (_, index) => {
  const id = index + 1;
  const groupName = index === 0
    ? '历史恢复-黄色-20260321'
    : index === 1
      ? '历史恢复-未分组-20260321'
      : '历史恢复-openai-business-long-group';

  return {
    id,
    email: index === 0
      ? 'khaaleyvene44@outlook.com'
      : `wanghengtry${String(id).padStart(2, '0')}@outlook.com`,
    provider: 'OUTLOOK',
    authType: 'MICROSOFT_OAUTH',
    hasStoredPassword: false,
    hasStoredAccountLoginPassword: true,
    capabilitySummary: mailboxCapabilitySummary,
    clientId: `${String(id).padStart(8, '0')}-d14b-4e18-b67b-8744c0f1${String(id).padStart(4, '0')}`,
    status: 'ACTIVE',
    groupId: id,
    group: { id, name: groupName },
    lastCheckAt: `2026-08-05T21:${String(55 - index).padStart(2, '0')}:00.000Z`,
    mailboxStatus: null,
    errorMessage: null,
    createdAt: '2026-08-05T21:50:00.000Z',
  };
});

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

async function mockAdminControlPlane(page: Page) {
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
        apiKeys: { total: 3, active: 2, totalUsage: 128, todayActive: 1 },
        domainMail: {
          domains: 2,
          activeDomains: 2,
          mailboxes: 4,
          activeMailboxes: 4,
          inboundMessages: 12,
          outboundMessages: 4,
        },
      });
      return;
    }
    if (pathname === '/admin/dashboard/api-trend') {
      await fulfillSuccess(route, [
        { date: '08-01', count: 8 },
        { date: '08-02', count: 12 },
      ]);
      return;
    }
    if (pathname === '/admin/dashboard/logs') {
      await fulfillSuccess(route, { list: [], total: 0 });
      return;
    }
    if (pathname === '/admin/emails/stats') {
      await fulfillSuccess(route, {
        total: externalMailboxRows.length,
        active: externalMailboxRows.length,
        error: 0,
        providers: { OUTLOOK: externalMailboxRows.length },
      });
      return;
    }
    if (pathname === '/admin/emails') {
      await fulfillSuccess(route, {
        list: externalMailboxRows,
        total: externalMailboxRows.length,
      });
      return;
    }
    if (pathname === '/admin/email-groups') {
      await fulfillSuccess(route, externalMailboxRows.map((row) => ({
        id: row.group.id,
        name: row.group.name,
        description: null,
        fetchStrategy: 'IMAP_ONLY',
        emailCount: 1,
        createdAt: row.createdAt,
        updatedAt: row.createdAt,
      })));
      return;
    }
    if (pathname === '/admin/oauth/providers') {
      await fulfillSuccess(route, oauthProviderStatuses);
      return;
    }

    await fulfillSuccess(route, {});
  });
}

async function mockMailboxPortal(page: Page) {
  await page.route('**/mail/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;

    if (!pathname.startsWith('/mail/api/')) {
      await route.continue();
      return;
    }
    if (pathname === '/mail/api/login') {
      await fulfillSuccess(route, { mailboxUser });
      return;
    }
    if (pathname === '/mail/api/session') {
      await fulfillSuccess(route, { authenticated: true, mailboxUser });
      return;
    }
    if (pathname === '/mail/api/mailboxes') {
      await fulfillSuccess(route, [
        {
          id: 1,
          address: 'inbox@example.test',
          displayName: 'Primary inbox',
          provisioningMode: 'API_POOL',
          forwardMode: 'DISABLED',
          sendReady: true,
          domain: {
            id: 1,
            name: 'example.test',
            canSend: true,
            canReceive: true,
          },
        },
      ]);
      return;
    }
    if (
      pathname === '/mail/api/messages'
      || pathname === '/mail/api/sent-messages'
      || pathname === '/mail/api/forwarding-jobs'
    ) {
      await fulfillSuccess(route, { list: [], total: 0 });
      return;
    }

    await fulfillSuccess(route, {});
  });
}

async function loginAsAdministrator(page: Page) {
  await page.goto('/login');
  await page.getByLabel('用户名或邮箱').fill('root');
  await page.getByLabel('密码').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: '进入管理控制台' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test('administrator login reaches the compact operator overview', async ({ page }, testInfo) => {
  await mockAdminControlPlane(page);
  await loginAsAdministrator(page);

  await page.goto('/dashboard?proof=degraded-data');
  await expect(page.getByRole('heading', { name: '运行概况' })).toBeVisible();
  await expect(page.getByText('待处理项')).toBeVisible();
  await expect(page.getByText('15 项需要处理')).toBeVisible();
  await expect(page.getByText('待办与健康')).toBeVisible();
  await expect(page.getByText('异常邮箱连接')).toBeVisible();
  await expect(page.getByText('先处理风险，再进入对象页')).toHaveCount(0);
  await expect(page.getByText('/ 100')).toHaveCount(0);
  await expect(page.locator('.dashboard-overview__provider-row')).toHaveCount(3);
  await expect(page.locator('.dashboard-overview__error-row')).toHaveCount(3);
  await expect(page.getByRole('img', { name: 'API 调用趋势图' })).toBeVisible();

  const summaryColumns = await page
    .locator('.dashboard-overview__summary-grid')
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);

  if (testInfo.project.name === 'Mobile Chromium') {
    await expect(page.getByRole('button', { name: '打开导航' })).toBeVisible();
    expect(summaryColumns).toBe(1);
    expect(pageHeight).toBeLessThan(3200);
  } else {
    expect(summaryColumns).toBe(2);
    expect(pageHeight).toBeLessThan(1800);
  }

  await testInfo.attach('administrator-dashboard', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('external mailbox list uses one fluid page viewport', async ({ page }, testInfo) => {
  await mockAdminControlPlane(page);
  await loginAsAdministrator(page);
  await page.goto('/emails');

  await expect(page.getByRole('heading', { name: '外部邮箱连接' })).toBeVisible();
  await expect(page.getByText('khaaleyvene44@outlook.com')).toBeVisible();

  const table = page.locator('.workspace-frame--resource .ant-table-wrapper').first();
  await expect(table).toBeVisible();

  const metrics = await table.evaluate((element) => {
    const container = element.querySelector<HTMLElement>('.ant-table-container');
    const body = element.querySelector<HTMLElement>('.ant-table-body');
    const firstRow = element.querySelector<HTMLElement>('.ant-table-tbody > tr');

    if (!container || !body || !firstRow) {
      throw new Error('external mailbox table structure is incomplete');
    }

    const actionButtons = Array.from(firstRow.querySelectorAll<HTMLElement>('button'));
    const containerRect = container.getBoundingClientRect();
    const furthestActionEdge = actionButtons.reduce(
      (right, button) => Math.max(right, button.getBoundingClientRect().right),
      containerRect.left,
    );
    const bodyStyle = getComputedStyle(body);
    const actionGrid = actionButtons[0]?.closest<HTMLElement>('.ant-space') ?? null;

    return {
      containerClientWidth: container.clientWidth,
      containerScrollWidth: container.scrollWidth,
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      bodyMaxHeight: bodyStyle.maxHeight,
      furthestActionEdge,
      containerRight: containerRect.right,
      actionGridColumns: actionGrid
        ? getComputedStyle(actionGrid).gridTemplateColumns.split(' ').length
        : 0,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });

  expect(metrics.containerScrollWidth).toBeLessThanOrEqual(metrics.containerClientWidth + 1);
  expect(metrics.bodyScrollHeight).toBeLessThanOrEqual(metrics.bodyClientHeight + 1);
  expect(metrics.bodyMaxHeight).toBe('none');
  expect(metrics.furthestActionEdge).toBeLessThanOrEqual(metrics.containerRight + 1);
  expect(metrics.actionGridColumns).toBe(3);
  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.documentClientWidth + 1);

  if (testInfo.project.name === 'Desktop Chromium') {
    await expect(page.getByRole('columnheader', { name: '客户端 ID' })).toBeHidden();
    await expect(page.getByRole('columnheader', { name: '创建时间' })).toBeHidden();
  } else {
    await expect(page.getByRole('button', { name: '打开导航' })).toBeVisible();
  }

  await testInfo.attach('external-mailbox-workspace', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});

test('portal login reaches the inbox-first workspace', async ({ page }, testInfo) => {
  await mockMailboxPortal(page);
  await page.goto('/mail/login');

  await page.getByLabel('门户用户名').fill('portal-user');
  await page.getByLabel('密码').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: '进入门户工作台' }).click();

  await expect(page).toHaveURL(/\/mail\/inbox$/);
  await expect(page.getByText('收件箱优先工作区')).toBeVisible();
  await expect(page.getByText('未读优先')).toBeVisible();

  if (testInfo.project.name === 'Mobile Chromium') {
    await expect(page.getByRole('button', { name: '打开门户导航' })).toBeVisible();
  }

  await testInfo.attach('mailbox-portal-inbox', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
});
