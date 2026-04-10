import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MailPortalSettingsPage from '..';
import { useMailboxAuthStore } from '../../../../stores/mailboxAuthStore';

vi.mock('../../../../contracts/portal/account', () => ({
  portalAccountContract: {
    getSession: vi.fn(),
    getMailboxes: vi.fn(),
    changePassword: vi.fn(),
    updateForwarding: vi.fn(),
    getForwardingJobs: vi.fn(),
  },
}));

import { portalAccountContract } from '../../../../contracts/portal/account';

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
  });

  it('syncs the forwarding form to the selected mailbox and surfaces recent forwarding results', async () => {
    render(
      <MemoryRouter
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <MailPortalSettingsPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: '设置中心' })).toBeInTheDocument();
    expect(await screen.findByDisplayValue('copy@example.net')).toBeInTheDocument();
    expect(await screen.findByText('Temporary resend failure')).toBeInTheDocument();
    expect(screen.getByText('待配置发件')).toBeInTheDocument();
    expect(screen.getByText('发件已就绪')).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('选择邮箱'));
    await userEvent.click(await screen.findByTitle('second@example.com'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('move@example.net')).toBeInTheDocument();
      expect(portalAccountContract.getForwardingJobs).toHaveBeenLastCalledWith({ mailboxId: 2, page: 1, pageSize: 5 });
    });
	}, 20000);
});
