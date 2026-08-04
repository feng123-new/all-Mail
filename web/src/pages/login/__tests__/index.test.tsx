import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';

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

import { authContract } from '../../../contracts/shared/auth';
import LoginPage from '..';

function renderLogin() {
  return render(
    <I18nProvider initialLanguage="zh-CN" persist={false}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </I18nProvider>,
  );
}

describe('LoginPage challenge flow', () => {
  it('keeps the verification-code step hidden before the server requires it', async () => {
    renderLogin();

    expect(await screen.findByRole('heading', { name: '登录管理控制台' })).toBeInTheDocument();
    expect(screen.queryByText('请输入验证器中的 6 位动态码')).not.toBeInTheDocument();
    expect(screen.queryByText('如果账号启用了 2FA，下一步会要求输入 6 位验证码')).not.toBeInTheDocument();
  });

  it('opens the verification-code step after an OTP_REQUIRED response', async () => {
    vi.mocked(authContract.login).mockRejectedValueOnce({ code: 'OTP_REQUIRED' });
    const user = userEvent.setup();
    renderLogin();

    await user.type(await screen.findByLabelText('用户名或邮箱'), 'root');
    await user.type(screen.getByLabelText('密码'), 'example-password');
    await user.click(screen.getByRole('button', { name: '进入管理控制台' }));

    expect(await screen.findByText('请输入验证器中的 6 位动态码')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('6 位验证码')).toBeInTheDocument();
  });
});
