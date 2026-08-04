import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { portalAccountContract } from '../../../contracts/portal/account';
import { authContract } from '../../../contracts/shared/auth';
import { I18nProvider } from '../../../i18n';
import LoginPage from '..';

vi.mock('../../../contracts/shared/auth', () => ({
  authContract: {
    login: vi.fn(),
  },
}));

vi.mock('../../../contracts/portal/account', () => ({
  portalAccountContract: {
    login: vi.fn(),
  },
}));

describe('LoginPage portal fallback route', () => {
  it('opens the inbox when the account is a portal user', async () => {
    vi.mocked(authContract.login).mockRejectedValue({ code: 'INVALID_CREDENTIALS' });
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

    render(
      <I18nProvider initialLanguage="zh-CN" persist={false}>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/mail/inbox" element={<div>Unified inbox landing</div>} />
            <Route path="/mail/settings" element={<div>Unified settings landing</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>,
    );

    await user.type(screen.getByLabelText('用户名或邮箱'), 'portal-user');
    await user.type(screen.getByLabelText('密码'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: '进入管理控制台' }));

    expect(await screen.findByText('Unified inbox landing')).toBeInTheDocument();
  });
});
