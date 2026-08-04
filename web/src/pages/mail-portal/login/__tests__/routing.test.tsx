import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { portalAccountContract } from '../../../../contracts/portal/account';
import { I18nProvider } from '../../../../i18n';
import MailPortalLoginPage from '..';

vi.mock('../../../../contracts/portal/account', () => ({
  portalAccountContract: {
    login: vi.fn(),
  },
}));

function renderPortalLogin() {
  return render(
    <I18nProvider initialLanguage="zh-CN" persist={false}>
      <MemoryRouter initialEntries={['/mail/login']}>
        <Routes>
          <Route path="/mail/login" element={<MailPortalLoginPage />} />
          <Route path="/mail/inbox" element={<div>Inbox landing</div>} />
          <Route path="/mail/settings" element={<div>Settings landing</div>} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('MailPortalLoginPage landing route', () => {
  it('opens the inbox after a normal portal login', async () => {
    vi.mocked(portalAccountContract.login).mockResolvedValue({
      code: 200,
      data: {
        mailboxUser: {
          id: 1,
          username: 'portal-user',
          mustChangePassword: false,
          mailboxIds: [1],
        },
      },
    } as never);
    const user = userEvent.setup();
    renderPortalLogin();

    await user.type(screen.getByLabelText('门户用户名'), 'portal-user');
    await user.type(screen.getByLabelText('密码'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: '进入门户工作台' }));

    expect(await screen.findByText('Inbox landing')).toBeInTheDocument();
  });

  it('sends first-password users to settings instead', async () => {
    vi.mocked(portalAccountContract.login).mockResolvedValue({
      code: 200,
      data: {
        mailboxUser: {
          id: 1,
          username: 'portal-user',
          mustChangePassword: true,
          mailboxIds: [1],
        },
      },
    } as never);
    const user = userEvent.setup();
    renderPortalLogin();

    await user.type(screen.getByLabelText('门户用户名'), 'portal-user');
    await user.type(screen.getByLabelText('密码'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: '进入门户工作台' }));

    expect(await screen.findByText('Settings landing')).toBeInTheDocument();
  });
});
