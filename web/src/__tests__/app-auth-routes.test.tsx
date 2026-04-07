import { Outlet } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authContract } from '../contracts/shared/auth';
import { portalAccountContract } from '../contracts/portal/account';
import { useAuthStore } from '../stores/authStore';
import { useMailboxAuthStore } from '../stores/mailboxAuthStore';

vi.mock('../contracts/shared/auth', () => ({
  authContract: {
    getMe: vi.fn(),
  },
}));

vi.mock('../contracts/portal/account', () => ({
  portalAccountContract: {
    getSession: vi.fn(),
  },
}));

vi.mock('../pages/login', () => ({
  default: () => <div>Admin Login Page</div>,
}));
vi.mock('../pages/mail-portal/login', () => ({
  default: () => <div>Mailbox Portal Login Page</div>,
}));
vi.mock('../layouts/MainLayout', () => ({
  default: () => (
    <div>
      <div>Admin Shell Layout</div>
      <Outlet />
    </div>
  ),
}));
vi.mock('../layouts/MailboxLayout', () => ({
  default: () => (
    <div>
      <div>Mailbox Shell Layout</div>
      <Outlet />
    </div>
  ),
}));
vi.mock('../pages/dashboard', () => ({
  default: () => <div>Dashboard Route</div>,
}));
vi.mock('../pages/emails', () => ({
  default: () => <div>Emails Route</div>,
}));
vi.mock('../pages/api-keys', () => ({
  default: () => <div>Api Keys Route</div>,
}));
vi.mock('../pages/api-docs', () => ({
  default: () => <div>Api Docs Route</div>,
}));
vi.mock('../pages/operation-logs', () => ({
  default: () => <div>Operation Logs Route</div>,
}));
vi.mock('../pages/admins', () => ({
  default: () => <div>Admins Route</div>,
}));
vi.mock('../pages/settings', () => ({
  default: () => <div>Settings Route</div>,
}));
vi.mock('../pages/domains', () => ({
  default: () => <div>Domains Route</div>,
}));
vi.mock('../pages/domain-mailboxes', () => ({
  default: () => <div>Domain Mailboxes Route</div>,
}));
vi.mock('../pages/mailbox-users', () => ({
  default: () => <div>Mailbox Users Route</div>,
}));
vi.mock('../pages/domain-messages', () => ({
  default: () => <div>Domain Messages Route</div>,
}));
vi.mock('../pages/forwarding-jobs', () => ({
  default: () => <div>Forwarding Jobs Route</div>,
}));
vi.mock('../pages/sending-configs', () => ({
  default: () => <div>Sending Configs Route</div>,
}));
vi.mock('../pages/mail-portal/overview', () => ({
  default: () => <div>Mail Portal Overview Route</div>,
}));
vi.mock('../pages/mail-portal/inbox', () => ({
  default: () => <div>Mail Portal Inbox Route</div>,
}));
vi.mock('../pages/mail-portal/settings', () => ({
  default: () => <div>Mail Portal Settings Route</div>,
}));

import App from '../App';

describe('App auth routing', () => {
  beforeEach(() => {
    useAuthStore.setState({ admin: null, isAuthenticated: false });
    useMailboxAuthStore.setState({ mailboxUser: null, isAuthenticated: false });
    vi.mocked(authContract.getMe).mockRejectedValue(new Error('UNAUTHORIZED'));
    vi.mocked(portalAccountContract.getSession).mockRejectedValue(new Error('UNAUTHORIZED'));
    window.history.pushState({}, '', '/');
  });

  it('redirects unauthenticated admin routes to the admin login page', async () => {
    window.history.pushState({}, '', '/dashboard');

    render(<App />);

    expect(await screen.findByText('Admin Login Page')).toBeInTheDocument();
  });

  it('renders the admin shell when an authenticated admin session exists', async () => {
    useAuthStore.setState({
      admin: {
        id: 1,
        username: 'operator',
        role: 'SUPER_ADMIN',
      },
      isAuthenticated: true,
    });
    window.history.pushState({}, '', '/dashboard');

    render(<App />);

    expect(await screen.findByText('Admin Shell Layout')).toBeInTheDocument();
  });

  it('renders the forwarding jobs route inside the authenticated admin shell', async () => {
    useAuthStore.setState({
      admin: {
        id: 1,
        username: 'operator',
        role: 'SUPER_ADMIN',
      },
      isAuthenticated: true,
    });
    window.history.pushState({}, '', '/forwarding-jobs');

    render(<App />);

    expect(await screen.findByText('Forwarding Jobs Route')).toBeInTheDocument();
  });

  it('redirects unauthenticated portal routes to the portal login page', async () => {
    window.history.pushState({}, '', '/mail/overview');

    render(<App />);

    expect(await screen.findByText('Mailbox Portal Login Page')).toBeInTheDocument();
  });

  it('bootstraps the admin shell from the cookie-backed session endpoint', async () => {
    vi.mocked(authContract.getMe).mockResolvedValue({
      code: 200,
      data: {
        id: 1,
        username: 'operator',
        role: 'SUPER_ADMIN',
      },
      message: 'Success',
    } as never);
    window.history.pushState({}, '', '/dashboard');

    render(<App />);

    expect(await screen.findByText('Admin Shell Layout')).toBeInTheDocument();
  });

  it('bootstraps the mailbox shell from the cookie-backed session endpoint', async () => {
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
    window.history.pushState({}, '', '/mail/overview');

    render(<App />);

    expect(await screen.findByText('Mailbox Shell Layout')).toBeInTheDocument();
  });

  it('redirects mailbox users with mustChangePassword to portal settings', async () => {
    useMailboxAuthStore.setState({
      mailboxUser: {
        id: 1,
        username: 'portal-user',
        mustChangePassword: true,
        mailboxIds: [1],
      },
      isAuthenticated: true,
    });
    window.history.pushState({}, '', '/mail/inbox');

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe('/mail/settings');
    });
  });
});
