import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import MailPortalOverviewPage from '..';
import { useMailboxAuthStore } from '../../../../stores/mailboxAuthStore';

vi.mock('../../../../contracts/portal/account', () => ({
  portalAccountContract: {
    getSession: vi.fn(),
    getMailboxes: vi.fn(),
    getMessages: vi.fn(),
  },
}));

import { portalAccountContract } from '../../../../contracts/portal/account';

describe('MailPortalOverviewPage proof scenario', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMailboxAuthStore.setState({
		mailboxUser: {
			id: 1,
			username: 'portal-demo-user',
			mailboxIds: [1, 2, 3],
			mustChangePassword: false,
		},
      isAuthenticated: true,
    });
  });

  it('renders unread-demo proof mode with unread verification-code evidence and no live contract calls', async () => {
    render(
      <MemoryRouter
        initialEntries={['/mail/overview?proof=unread-demo']}
        future={{
          v7_relativeSplatPath: true,
          v7_startTransition: true,
        }}
      >
        <MailPortalOverviewPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Proof scenario · unread demo')).toBeInTheDocument();
    expect(screen.getByText('Amazon Security Code')).toBeInTheDocument();
    expect(screen.getByText('验证码：482761')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /复制验证码/ })).toBeInTheDocument();
    expect(screen.getByText('优先展示最值得处理的 4 个邮箱')).toBeInTheDocument();
    expect(portalAccountContract.getSession).not.toHaveBeenCalled();
    expect(portalAccountContract.getMailboxes).not.toHaveBeenCalled();
    expect(portalAccountContract.getMessages).not.toHaveBeenCalled();
  });
});
