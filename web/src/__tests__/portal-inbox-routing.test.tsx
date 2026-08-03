import { render, screen, waitFor } from '@testing-library/react';
import { Outlet } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { portalAccountContract } from '../contracts/portal/account';
import { useAuthStore } from '../stores/authStore';
import { useMailboxAuthStore } from '../stores/mailboxAuthStore';

vi.mock('../contracts/shared/auth', () => ({
  authContract: {
    getMe: vi.fn().mockRejectedValue(new Error('UNAUTHORIZED')),
  },
}));

vi.mock('../contracts/portal/account', () => ({
  portalAccountContract: {
    getSession: vi.fn(),
  },
}));

vi.mock('../layouts/MailboxLayout', () => ({
  default: () => (
    <div>
      <div>Mailbox Shell Layout</div>
      <Outlet />
    </div>
  ),
}));

vi.mock('../pages/mail-portal/login', () => ({
  default: () => <div>Mailbox Portal Login Page</div>,
}));

vi.mock('../pages/mail-portal/inbox', () => ({
  default: () => <div>Mail Portal Inbox Route</div>,
}));

vi.mock('../pages/mail-portal/overview', () => ({
  default: () => <div>Mail Portal Overview Route</div>,
}));

vi.mock('../pages/mail-portal/settings', () => ({
  default: () => <div>Mail Portal Settings Route</div>,
}));

import App from '../App';

describe('portal inbox-first routing', () => {
  beforeEach(() => {
    useAuthStore.setState({ admin: null, isAuthenticated: false });
    useMailboxAuthStore.setState({ mailboxUser: null, isAuthenticated: false });
    vi.mocked(portalAccountContract.getSession).mockRejectedValue(new Error('UNAUTHORIZED'));
    window.history.pushState({}, '', '/');
  });

  it('redirects the authenticated /mail entry to the inbox', async () => {
    useMailboxAuthStore.setState({
      mailboxUser: {
        id: 1,
        username: 'portal-user',
        mailboxIds: [1],
      },
      isAuthenticated: true,
    });
    window.history.pushState({}, '', '/mail');

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/mail/inbox');
    });
    expect(await screen.findByText('Mail Portal Inbox Route')).toBeInTheDocument();
  });

  it('keeps forced password rotation ahead of the inbox landing', async () => {
    useMailboxAuthStore.setState({
      mailboxUser: {
        id: 1,
        username: 'portal-user',
        mustChangePassword: true,
        mailboxIds: [1],
      },
      isAuthenticated: true,
    });
    window.history.pushState({}, '', '/mail');

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/mail/settings');
    });
    expect(await screen.findByText('Mail Portal Settings Route')).toBeInTheDocument();
  });

  it('uses the cookie-backed session bootstrap before opening the inbox', async () => {
    vi.mocked(portalAccountContract.getSession).mockResolvedValue({
      code: 200,
      data: {
        authenticated: true,
        mailboxUser: {
          id: 1,
          username: 'portal-user',
          mailboxIds: [1],
        },
      },
      message: 'Success',
    } as never);
    window.history.pushState({}, '', '/mail');

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/mail/inbox');
    });
    expect(await screen.findByText('Mail Portal Inbox Route')).toBeInTheDocument();
  });
});
