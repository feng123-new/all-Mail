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

test('Gmail workspace keeps temporary app passwords out of durable accounts', async ({ page }, testInfo) => {
  await mockAdminControlPlane(page);
  const savedEmail = 'saved@example.test';
  const temporaryEmail = 'temporary@example.test';
  const temporaryPassword = 'abcd efgh ijkl mnop';
  const savedRequests: Array<unknown> = [];
  let temporaryRequests = 0;
  const temporarySends: Array<unknown> = [];
  const gmailRow = (id: number, email: string) => ({
    ...externalMailboxRows[0], id, email, provider: 'GMAIL', authType: 'APP_PASSWORD',
    capabilitySummary: mailboxCapabilitySummary,
  });
  await page.route(/\/admin\/emails(?:[/?]|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const methods = request.method();
    const pathname = url.pathname;
    if (pathname === '/admin/emails' && methods === 'GET' && url.searchParams.get('provider') === 'GMAIL') {
      const list = [gmailRow(501, 'oauth@example.test'), ...(savedRequests.length ? [gmailRow(502, savedEmail)] : [])];
      await fulfillSuccess(route, { list, total: list.length });
    } else if (pathname === '/admin/emails' && methods === 'POST') {
      savedRequests.push(request.postDataJSON());
      await fulfillSuccess(route, { id: 502 });
    } else if (pathname === '/admin/emails/gmail/temporary' && methods === 'POST') {
      temporaryRequests += 1;
      const data = request.postDataJSON();
      expect(data.password).toBe('abcdefghijklmnop');
      if (data.operation === 'detail') {
        expect(data).toMatchObject({ email: temporaryEmail, mailbox: 'INBOX', messageId: 'uid:1', uidValidity: 7 });
        await fulfillSuccess(route, { text: 'Body from temporary account' });
      } else if (data.operation === 'send') {
        expect(data.email).toBe(temporaryEmail);
        temporarySends.push(data.message);
        await fulfillSuccess(route, { accepted: ['recipient@example.test'] });
      } else {
        expect(data.operation).toBe('list');
        await fulfillSuccess(route, {
          messages: [{ id: 'uid:1', subject: 'Temporary mail', from: 'sender@example.test', date: '2026-08-06T12:00:00Z' }],
          mailboxCheckpoint: { uidValidity: 7 },
        });
      }
    } else if (pathname === '/admin/emails/501/mails' || pathname === '/admin/emails/502/mails') {
      await fulfillSuccess(route, { messages: [{ id: '1', subject: 'Saved mail', from: 'sender@example.test', date: '2026-08-05T12:00:00Z' }] });
    } else {
      await route.fallback();
    }
  });
  await loginAsAdministrator(page);
  await page.goto('/emails');
  await page.getByRole('button', { name: 'Gmail 工作区' }).click();
  await expect(page.getByRole('button', { name: 'Saved mail' })).toBeVisible();
  const connectWithPassword = async (email: string, persist: boolean) => {
    await page.getByRole('button', { name: '应用专用密码', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '使用 Google 应用专用密码' });
    await dialog.getByLabel('Gmail 邮箱地址').fill(email);
    await dialog.getByLabel('应用专用密码', { exact: true }).fill(temporaryPassword);
    const save = dialog.getByRole('checkbox', { name: '加密保存，供下次使用' });
    await expect(save).not.toBeChecked();
    if (persist) await save.check();
    await dialog.getByRole('button', { name: /^连\s*接$/ }).click();
    await expect(dialog).toBeHidden();
  };
  await connectWithPassword(temporaryEmail, false);
  await expect(page.getByRole('button', { name: 'Temporary mail' })).toBeVisible();
  expect(temporaryRequests).toBeGreaterThan(0);
  expect(savedRequests).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain('abcdefghijklmnop');
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1);
  const proof = testInfo.outputPath('gmail-workspace.png');
  await page.screenshot({ path: proof });
  await testInfo.attach('gmail-workspace', { path: proof, contentType: 'image/png' });

  await page.getByRole('button', { name: 'Temporary mail' }).click();
  const detail = page.getByRole('dialog', { name: 'Temporary mail' });
  await expect(detail.getByText('Body from temporary account')).toBeVisible();
  await detail.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: '写邮件' }).click();
  const compose = page.getByRole('dialog', { name: '写邮件' });
  await compose.getByRole('combobox', { name: '发件人' }).click();
  await page.locator('.ant-select-dropdown').getByText(temporaryEmail, { exact: true }).click();
  await compose.getByLabel('收件人').fill('recipient@example.test');
  await compose.getByLabel('主题').fill('Temporary send');
  await compose.getByLabel('正文').fill('Synthetic test body');
  await compose.getByRole('button', { name: /^发\s*送$/ }).click();
  await expect.poll(() => temporarySends).toEqual([
    { to: ['recipient@example.test'], subject: 'Temporary send', text: 'Synthetic test body' },
  ]);
  expect(savedRequests).toEqual([]);

  await page.reload();
  await page.getByRole('button', { name: 'Gmail 工作区' }).click();
  await expect(page.getByRole('button', { name: 'Saved mail' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Temporary mail' })).toHaveCount(0);
  await connectWithPassword(savedEmail, true);
  await expect.poll(() => savedRequests).toEqual([
    { provider: 'GMAIL', authType: 'APP_PASSWORD', email: savedEmail, password: 'abcdefghijklmnop' },
  ]);
});

test('Gmail authorization opens the Google page and returns to the workspace', async ({ page }) => {
  await mockAdminControlPlane(page);
  const google = 'https://accounts.google.com/o/oauth2/v2/auth?state=fixture';
  await page.route('**/admin/oauth/providers', (route) => fulfillSuccess(route, {
    ...oauthProviderStatuses,
    GMAIL: { ...oauthProviderStatuses.GMAIL, configured: true, scopeProfile: 'send', redirectUri: 'http://127.0.0.1:5173/admin/oauth/google/callback' },
  }));
  await page.route('**/admin/oauth/google/start', (route) => {
    expect(route.request().postDataJSON()).toEqual({});
    return fulfillSuccess(route, { authUrl: google, state: 'fixture' });
  });
  await page.route(google, (route) => route.fulfill({
    contentType: 'text/html', body: '<h1>Google consent fixture</h1>',
  }));
  await loginAsAdministrator(page);
  await page.goto('/emails');
  await page.getByRole('button', { name: 'Gmail 工作区' }).click();
  await page.getByRole('button', { name: '通过 Google 连接' }).click();
  await expect(page.getByRole('heading', { name: 'Google consent fixture' })).toBeVisible();
  await expect(page).toHaveURL(google);

  await page.goto('http://127.0.0.1:5173/emails?oauth_status=success&oauth_provider=GMAIL&oauth_code=OAUTH_AUTHORIZED_SUCCESS');
  await expect(page.getByRole('tab', { name: 'Gmail', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/\/emails$/);
});

test('Google login details unlock, edit and lock independently of mail', async ({ page }, testInfo) => {
  await mockAdminControlPlane(page);
  const administrator = { ...admin, twoFactorEnabled: true };
  await page.route('**/admin/auth/login', (route) => fulfillSuccess(route, { admin: administrator }));
  await page.route('**/admin/auth/me', (route) => fulfillSuccess(route, administrator));
  await page.route(/\/admin\/emails\?/, async (route) => {
    if (new URL(route.request().url()).searchParams.get('provider') !== 'GMAIL') return route.fallback();
    await fulfillSuccess(route, { list: [{ ...externalMailboxRows[0], id: 701, provider: 'GMAIL', authType: 'GOOGLE_OAUTH', email: 'manual-login@example.test', status: 'DISABLED' }], total: 1 });
  });
  const now = () => new Date().toISOString();
  const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();
  let notes = '仅测试用的备用登录备注';
  let codeRequests = 0;
  let password = 'browser-fixture-password';
  await page.route('**/admin/emails/reveal-unlock', (route) => {
    expect(route.request().postDataJSON()).toEqual({ otp: '654321' });
    return fulfillSuccess(route, { grantToken: 'synthetic-grant', expiresAt: ahead(180_000) });
  });
  await page.route('**/admin/emails/701/login-details', async (route) => {
    const data = route.request().postDataJSON();
    expect(data).toMatchObject({ grantToken: 'synthetic-grant', email: 'manual-login@example.test' });
    if (route.request().method() === 'PATCH') {
      if ('notes' in data) notes = data.notes;
      if ('password' in data) password = data.password;
      await fulfillSuccess(route, { updated: true });
    } else {
      if (data.codeOnly) codeRequests += 1;
      await fulfillSuccess(route, {
        ...(data.codeOnly ? {} : { password: password || undefined, notes }),
        code: codeRequests ? '234567' : '123456', codeExpiresAt: ahead(29_000), serverTime: now(),
      });
    }
  });
  await loginAsAdministrator(page);
  await page.goto('/emails');
  await page.getByRole('button', { name: 'Gmail 工作区' }).click();
  const entry = page.getByRole('button', { name: 'Google 登录资料' });
  await entry.click();
  const dialog = page.getByRole('dialog', { name: 'Google 登录资料' });
  const unlock = async () => {
    await dialog.getByLabel('all-Mail 管理员验证码').fill('654321');
    await dialog.getByRole('button', { name: /^解\s*锁$/ }).click();
    await expect(dialog.getByLabel('备注（纯文本）')).toHaveValue(notes);
  };
  await expect(dialog.getByLabel('备注（纯文本）')).toHaveCount(0);
  await unlock();
  await expect(dialog.getByText('123456', { exact: true })).toBeVisible();
  await expect(dialog.getByText(password, { exact: true })).toHaveCount(0);
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds && viewport && bounds.x >= 0 && bounds.y >= 0
    && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height).toBeTruthy();
  await expect(dialog.getByRole('button', { name: '保存修改' })).toBeInViewport();
  const proof = testInfo.outputPath('google-login-details.png');
  await page.screenshot({ path: proof });
  await testInfo.attach('google-login-details', { path: proof, contentType: 'image/png' });
  await dialog.getByRole('button', { name: '显示密码' }).click();
  await expect(dialog.getByText(password, { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '刷新 Google 动态码' }).click();
  await expect(dialog.getByText('234567', { exact: true })).toBeVisible();
  const edited = '备用登录\n<em>纯文本</em>';
  await dialog.getByLabel('备注（纯文本）').fill(edited);
  await dialog.getByRole('button', { name: '保存修改' }).click();
  await expect.poll(() => notes).toBe(edited);
  await dialog.getByRole('button', { name: '清除密码' }).click();
  await expect.poll(() => password).toBe('');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await entry.click();
  await expect(dialog.getByLabel('备注（纯文本）')).toHaveCount(0);
  await unlock();
  await expect(dialog.getByLabel('备注（纯文本）')).toHaveValue(edited);
});

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
    const firstRow = element.querySelector<HTMLElement>(
      '.ant-table-tbody > tr.ant-table-row',
    );

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
    const actionCell = actionButtons[0]?.closest<HTMLElement>('td') ?? null;
    const actionGrid = actionCell?.querySelector<HTMLElement>('.ant-space') ?? null;

    return {
      containerClientWidth: container.clientWidth,
      containerScrollWidth: container.scrollWidth,
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      bodyMaxHeight: bodyStyle.maxHeight,
      furthestActionEdge,
      containerRight: containerRect.right,
      actionGridColumns: actionGrid
        ? getComputedStyle(actionGrid).gridTemplateColumns
            .trim()
            .split(/\s+/)
            .filter(Boolean).length
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
