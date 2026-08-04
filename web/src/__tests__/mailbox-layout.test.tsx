import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import MailboxLayout from '../layouts/MailboxLayout';
import { I18nProvider } from '../i18n';
import { useMailboxAuthStore } from '../stores/mailboxAuthStore';

vi.mock('../api', () => ({
  mailboxPortalApi: {
    logout: vi.fn(),
  },
}));

function renderMailboxLayout(path: string) {
  useMailboxAuthStore.setState({
    mailboxUser: {
      id: 1,
      username: 'portal-user',
      mailboxIds: [11, 12],
    },
    isAuthenticated: true,
  });

  return render(
    <I18nProvider initialLanguage="zh-CN" persist={false}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/mail" element={<MailboxLayout />}>
            <Route path="inbox" element={<div>Inbox child</div>} />
            <Route path="overview" element={<div>Overview child</div>} />
            <Route path="settings" element={<div>Settings child</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('MailboxLayout inbox-first navigation', () => {
  it('places the inbox before overview and exposes inbox-specific context', async () => {
    renderMailboxLayout('/mail/inbox');

    expect(await screen.findByText('收件箱优先工作区')).toBeInTheDocument();
    expect(screen.getByText('Inbox child')).toBeInTheDocument();

    const navigationLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/mail/'));

    expect(navigationLinks.map((link) => link.textContent)).toEqual([
      '收/发件工作区',
      '门户工作台',
      '设置中心',
    ]);
  });

  it('uses distinct overview and settings context', async () => {
    const overview = renderMailboxLayout('/mail/overview');
    expect(await screen.findByText('资源与待办概览')).toBeInTheDocument();
    expect(screen.getByText('Overview child')).toBeInTheDocument();
    overview.unmount();

    renderMailboxLayout('/mail/settings');
    expect(await screen.findByText('账号与邮箱设置')).toBeInTheDocument();
    expect(screen.getByText('Settings child')).toBeInTheDocument();
  });

  it('opens the portal navigation on a narrow viewport', async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });

    try {
      renderMailboxLayout('/mail/inbox');
      window.dispatchEvent(new Event('resize'));

      const user = userEvent.setup();
      const trigger = await screen.findByRole('button', { name: '打开门户导航' });
      await user.click(trigger);

      expect(await screen.findByRole('button', { name: '关闭门户导航' })).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
      window.dispatchEvent(new Event('resize'));
    }
  });
});
