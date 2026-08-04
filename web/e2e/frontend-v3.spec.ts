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
        total: 2,
        active: 2,
        error: 0,
        providers: { OUTLOOK: 1, GMAIL: 1 },
      });
      return;
    }
    if (pathname === '/admin/emails') {
      await fulfillSuccess(route, { list: [], total: 0 });
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

test('administrator login reaches the compact operator overview', async ({ page }, testInfo) => {
  await mockAdminControlPlane(page);
  await page.goto('/login');

  await page.getByLabel('用户名或邮箱').fill('root');
  await page.getByLabel('密码').fill('correct-horse-battery-staple');
  await page.getByRole('button', { name: '进入管理控制台' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
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
