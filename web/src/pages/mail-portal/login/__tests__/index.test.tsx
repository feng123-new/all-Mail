import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { portalAccountContract } from '../../../../contracts/portal/account';
import { useMailboxAuthStore } from '../../../../stores/mailboxAuthStore';
import MailPortalLoginPage from '..';

vi.mock('../../../../contracts/portal/account', () => ({
  portalAccountContract: {
    login: vi.fn(),
  },
}));

function ok<T>(data: T) {
  return Promise.resolve({ code: 200, data });
}

describe('MailPortalLoginPage two-factor challenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    useMailboxAuthStore.setState({
      mailboxUser: null,
      isAuthenticated: false,
    });
  });

  it('opens the OTP modal for OTP_REQUIRED and keeps it open after an invalid code', async () => {
    const user = userEvent.setup();
    vi.mocked(portalAccountContract.login)
      .mockRejectedValueOnce({ code: 'OTP_REQUIRED' })
      .mockRejectedValueOnce({ code: 'INVALID_OTP' })
      .mockReturnValueOnce(ok({
        mailboxUser: {
          id: 1,
          username: 'portal-user',
          mustChangePassword: false,
        },
      }) as never);

    render(
      <MemoryRouter>
        <MailPortalLoginPage />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('门户用户名'), 'portal-user');
    await user.type(screen.getByLabelText('密码'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: '进入门户工作台' }));

    const dialog = await screen.findByRole('dialog', { name: '二次验证' });
    const otpInput = within(dialog).getByLabelText('验证码');
    await user.type(otpInput, '111111');
    await user.click(within(dialog).getByRole('button', { name: '验证并登录' }));

    expect(await screen.findByText('验证码错误，请重试')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '二次验证' })).toBeInTheDocument();

    await user.clear(otpInput);
    await user.type(otpInput, '123456');
    await user.click(within(dialog).getByRole('button', { name: '验证并登录' }));

    await waitFor(() => {
      expect(useMailboxAuthStore.getState()).toMatchObject({
        isAuthenticated: true,
        mailboxUser: { username: 'portal-user' },
      });
    });
    expect(portalAccountContract.login).toHaveBeenNthCalledWith(1, 'portal-user', 'correct-horse');
    expect(portalAccountContract.login).toHaveBeenNthCalledWith(2, 'portal-user', 'correct-horse', '111111');
    expect(portalAccountContract.login).toHaveBeenNthCalledWith(3, 'portal-user', 'correct-horse', '123456');
    expect(screen.queryByRole('dialog', { name: '二次验证' })).not.toBeInTheDocument();
  });

  it('purges legacy portal credentials and prefills only the username', async () => {
    window.localStorage.setItem(
      'all-mail:portal-login:42',
      JSON.stringify({ username: 'legacy-user', password: 'persisted-password' }),
    );
    window.localStorage.setItem('all-mail:unrelated-setting', 'keep-me');

    render(
      <MemoryRouter initialEntries={['/mail/login?username=query-user']}>
        <MailPortalLoginPage />
      </MemoryRouter>,
    );

    expect(await screen.findByLabelText('门户用户名')).toHaveValue('query-user');
    expect(screen.getByLabelText('密码')).toHaveValue('');
    expect(window.localStorage.getItem('all-mail:portal-login:42')).toBeNull();
    expect(window.localStorage.getItem('all-mail:unrelated-setting')).toBe('keep-me');
  });
});
