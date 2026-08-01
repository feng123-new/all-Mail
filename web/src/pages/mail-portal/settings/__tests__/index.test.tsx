import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { portalAccountContract } from '../../../../contracts/portal/account';
import { useMailboxAuthStore } from '../../../../stores/mailboxAuthStore';
import MailPortalSettingsPage from '..';

vi.mock('antd', async () => {
  const actual = await vi.importActual<typeof import('antd')>('antd');
  return {
    ...actual,
    QRCode: ({ value }: { value: string }) => <div data-testid="two-factor-qr-code" data-value={value} />,
  };
});

vi.mock('../../../../contracts/portal/account', () => ({
  portalAccountContract: {
    getSession: vi.fn(),
    getMailboxes: vi.fn(),
    changePassword: vi.fn(),
    getTwoFactorStatus: vi.fn(),
    setupTwoFactor: vi.fn(),
    enableTwoFactor: vi.fn(),
    disableTwoFactor: vi.fn(),
    updateForwarding: vi.fn(),
    getForwardingJobs: vi.fn(),
  },
}));

function ok<T>(data: T) {
  return Promise.resolve({ code: 200, data });
}

describe('MailPortalSettingsPage forwarding closure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMailboxAuthStore.setState({
      mailboxUser: {
        id: 1,
        username: 'portal-user',
        mailboxIds: [1, 2],
        mustChangePassword: false,
      },
      isAuthenticated: true,
    });

    vi.mocked(portalAccountContract.getSession).mockReturnValue(ok({
      authenticated: true,
      mailboxUser: {
        id: 1,
        username: 'portal-user',
        status: 'ACTIVE',
        mustChangePassword: false,
        lastLoginAt: '2026-04-02T10:00:00.000Z',
      },
    }) as never);
    vi.mocked(portalAccountContract.getMailboxes).mockReturnValue(ok([
      {
        id: 1,
        address: 'first@example.com',
		sendReady: false,
        forwardMode: 'COPY',
        forwardTo: 'copy@example.net',
        domain: { id: 1, name: 'example.com', canSend: true, canReceive: true },
      },
      {
        id: 2,
        address: 'second@example.com',
		sendReady: true,
        forwardMode: 'MOVE',
        forwardTo: 'move@example.net',
        domain: { id: 1, name: 'example.com', canSend: true, canReceive: true },
      },
    ]) as never);
    vi.mocked(portalAccountContract.getForwardingJobs).mockReturnValue(ok({
      list: [{
        id: '501',
        status: 'FAILED',
        mode: 'MOVE',
        forwardTo: 'move@example.net',
        processedAt: '2026-04-02T11:00:00.000Z',
        lastError: 'Temporary resend failure',
        inboundMessage: {
          subject: 'Verification',
          fromAddress: 'sender@example.org',
        },
      }],
      total: 1,
      page: 1,
      pageSize: 5,
    }) as never);
    vi.mocked(portalAccountContract.getTwoFactorStatus).mockReturnValue(ok({
      enabled: false,
      pending: false,
    }) as never);
  });

  it('syncs the forwarding form to the selected mailbox and surfaces recent forwarding results', async () => {
    render(
      <MemoryRouter
      >
        <MailPortalSettingsPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: '设置中心' })).toBeInTheDocument();
    expect(await screen.findByDisplayValue('copy@example.net')).toBeInTheDocument();
    expect(await screen.findByText('Temporary resend failure')).toBeInTheDocument();
    expect(screen.getByText('待配置发件')).toBeInTheDocument();
    expect(screen.getByText('发件已就绪')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByLabelText('选择邮箱'));
    fireEvent.click(await screen.findByTitle('second@example.com'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('move@example.net')).toBeInTheDocument();
      expect(portalAccountContract.getForwardingJobs).toHaveBeenLastCalledWith({ mailboxId: 2, page: 1, pageSize: 5 });
    });
	}, 20000);

  it('loads two-factor status only after a forced password change is cleared', async () => {
    useMailboxAuthStore.setState({
      mailboxUser: {
        id: 1,
        username: 'portal-user',
        mailboxIds: [1, 2],
        mustChangePassword: true,
      },
      isAuthenticated: true,
    });
    vi.mocked(portalAccountContract.getSession)
      .mockReturnValueOnce(ok({
        authenticated: true,
        mailboxUser: {
          id: 1,
          username: 'portal-user',
          status: 'ACTIVE',
          mustChangePassword: true,
        },
      }) as never)
      .mockReturnValueOnce(ok({
        authenticated: true,
        mailboxUser: {
          id: 1,
          username: 'portal-user',
          status: 'ACTIVE',
          mustChangePassword: false,
        },
      }) as never);
    vi.mocked(portalAccountContract.changePassword).mockReturnValue(ok({}) as never);

    render(
      <MemoryRouter>
        <MailPortalSettingsPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('当前账号仍处于首次密码状态')).toBeInTheDocument();
    expect(portalAccountContract.getTwoFactorStatus).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'old-password' } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: '更新密码' }));

    await waitFor(() => {
      expect(portalAccountContract.getTwoFactorStatus).toHaveBeenCalled();
    });
  });

  it('sets up, enables, refreshes, and disables mailbox two-factor authentication', async () => {
    let twoFactorStatus = { enabled: false, pending: false };
    vi.mocked(portalAccountContract.getTwoFactorStatus).mockImplementation(
      () => ok(twoFactorStatus) as never,
    );
    vi.mocked(portalAccountContract.setupTwoFactor).mockReturnValue(ok({
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUrl: 'otpauth://totp/all-mail:portal-user?secret=JBSWY3DPEHPK3PXP',
    }) as never);
    vi.mocked(portalAccountContract.enableTwoFactor).mockReturnValue(ok({ enabled: true }) as never);
    vi.mocked(portalAccountContract.disableTwoFactor).mockReturnValue(ok({ enabled: false }) as never);

    render(
      <MemoryRouter>
        <MailPortalSettingsPage />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { name: '设置中心' });
    await waitFor(() => {
      expect(portalAccountContract.getTwoFactorStatus).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole('button', { name: '生成绑定密钥' }));
    expect(await screen.findByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    expect(screen.getByTestId('two-factor-qr-code')).toHaveAttribute(
      'data-value',
      'otpauth://totp/all-mail:portal-user?secret=JBSWY3DPEHPK3PXP',
    );
    expect(portalAccountContract.setupTwoFactor).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('输入验证器中的 6 位验证码'), { target: { value: '123456' } });
    twoFactorStatus = { enabled: true, pending: false };
    fireEvent.click(screen.getByRole('button', { name: '启用双重验证' }));

    await waitFor(() => {
      expect(portalAccountContract.enableTwoFactor).toHaveBeenCalledWith('123456');
    });
    expect(await screen.findByRole('button', { name: '禁用双重验证' })).toBeInTheDocument();

    const passwordInputs = screen.getAllByLabelText('当前密码');
    fireEvent.change(passwordInputs[passwordInputs.length - 1], { target: { value: 'current-password' } });
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '654321' } });
    twoFactorStatus = { enabled: false, pending: false };
    fireEvent.click(screen.getByRole('button', { name: '禁用双重验证' }));

    await waitFor(() => {
      expect(portalAccountContract.disableTwoFactor).toHaveBeenCalledWith('current-password', '654321');
    });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '禁用双重验证' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '生成绑定密钥' })).toBeInTheDocument();
    });
  }, 30000);
});
