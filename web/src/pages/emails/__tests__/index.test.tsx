import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmailsPage from '..';
import { useAuthStore } from '../../../stores/authStore';

vi.mock('../../../contracts/admin/emails', () => ({
	emailsContract: {
		getList: vi.fn(),
		getGroups: vi.fn(),
		getProviderStatuses: vi.fn(),
		revealUnlock: vi.fn(),
		revealSecrets: vi.fn(),
		getById: vi.fn(),
		getStats: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		batchDelete: vi.fn(),
		import: vi.fn(),
		export: vi.fn(),
		viewMails: vi.fn(),
		clearMailbox: vi.fn(),
		deleteSelectedMails: vi.fn(),
		batchFetchMailboxes: vi.fn(),
		batchClearMailbox: vi.fn(),
		sendMail: vi.fn(),
		createGroup: vi.fn(),
		updateGroup: vi.fn(),
		deleteGroup: vi.fn(),
		assignEmails: vi.fn(),
		removeEmails: vi.fn(),
		getAuthorizationStatus: vi.fn(),
		parseGoogleClientSecret: vi.fn(),
		saveConfig: vi.fn(),
		startAuthorization: vi.fn(),
	},
}));

import { emailsContract } from '../../../contracts/admin/emails';

function ok<T>(data: T) {
	return Promise.resolve({ code: 200, data });
}

function buildCapabilitySummary(
	overrides: Partial<Record<string, unknown>> = {},
) {
	return {
		readInbox: true,
		readJunk: true,
		readSent: true,
		clearMailbox: false,
		sendMail: true,
		usesOAuth: false,
		receiveMail: true,
		apiAccess: false,
		forwarding: false,
		search: false,
		refreshToken: false,
		webhook: false,
		aliasSupport: false,
		modes: [],
		...overrides,
	};
}

function buildRow(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: 1,
		email: 'ops@example.com',
		provider: 'QQ',
		authType: 'APP_PASSWORD',
		hasStoredPassword: true,
		hasStoredAccountLoginPassword: true,
		capabilitySummary: buildCapabilitySummary(),
		clientId: null,
		status: 'ACTIVE',
		groupId: null,
		group: null,
		lastCheckAt: null,
		mailboxStatus: null,
		errorMessage: null,
		createdAt: '2026-04-02T00:00:00.000Z',
		...overrides,
	};
}

	describe('EmailsPage login password button', () => {
	beforeEach(() => {
		useAuthStore.setState({
			admin: {
				id: 1,
				username: 'admin',
				role: 'ADMIN',
				twoFactorEnabled: true,
			},
			isAuthenticated: true,
		});

		vi.mocked(emailsContract.getGroups).mockReturnValue(ok([]) as never);
		vi.mocked(emailsContract.getProviderStatuses).mockReturnValue(
			ok({
				GMAIL: {
					configured: false,
					redirectUri: null,
					source: 'none',
					clientId: null,
					scopes: null,
					tenant: null,
					hasClientSecret: false,
				},
				OUTLOOK: {
					configured: false,
					redirectUri: null,
					source: 'none',
					clientId: null,
					scopes: null,
					tenant: null,
					hasClientSecret: false,
				},
			}) as never,
		);
	});

	it('renders a blue login password button when a stored account login password exists', async () => {
		vi.mocked(emailsContract.getList).mockReturnValue(
			ok({ list: [buildRow()], total: 1 }) as never,
		);

		render(
			<MemoryRouter
				future={{
					v7_relativeSplatPath: true,
					v7_startTransition: true,
				}}
			>
				<EmailsPage />
			</MemoryRouter>,
		);

		await screen.findByText('ops@example.com');
		const passwordButton = screen.getByRole('button', { name: /登录密码/ });
		expect(passwordButton).toHaveClass('ant-btn-primary');
	}, 10000);

	it('clicking the login password button shows the missing-account-password message and skips unlock', async () => {
		vi.mocked(emailsContract.getList).mockReturnValue(
			ok({
				list: [buildRow({ hasStoredAccountLoginPassword: false, email: 'nopass@example.com' })],
				total: 1,
			}) as never,
		);

		render(
			<MemoryRouter
				future={{
					v7_relativeSplatPath: true,
					v7_startTransition: true,
				}}
			>
				<EmailsPage />
			</MemoryRouter>,
		);

		await screen.findByText('nopass@example.com');
		await userEvent.click(screen.getByRole('button', { name: /登录密码/ }));

		const noPasswordHints = await screen.findAllByText('该账号暂无已存储的账号登录密码，可在启用 2FA 后进入编辑页补录');
		expect(noPasswordHints.length).toBeGreaterThan(0);
		expect(emailsContract.revealUnlock).not.toHaveBeenCalled();
	});

	it('clicking a blue login password button without 2FA warns before unlock', async () => {
		useAuthStore.setState({
			admin: {
				id: 1,
				username: 'admin',
				role: 'ADMIN',
				twoFactorEnabled: false,
			},
			isAuthenticated: true,
		});
		vi.mocked(emailsContract.getList).mockReturnValue(
			ok({ list: [buildRow({ email: 'twofa@example.com' })], total: 1 }) as never,
		);

		render(
			<MemoryRouter
				future={{
					v7_relativeSplatPath: true,
					v7_startTransition: true,
				}}
			>
				<EmailsPage />
			</MemoryRouter>,
		);

		await screen.findByText('twofa@example.com');
		await userEvent.click(screen.getByRole('button', { name: /登录密码/ }));

		await waitFor(() => {
			expect(screen.getByText('请先在设置页启用 2FA，再查看已存储的密钥')).toBeInTheDocument();
		});
		expect(emailsContract.revealUnlock).not.toHaveBeenCalled();
	});

	it('allows oauth rows to expose stored account login passwords', async () => {
		vi.mocked(emailsContract.getList).mockReturnValue(
			ok({
				list: [
					buildRow({
						email: 'oauth@example.com',
						provider: 'OUTLOOK',
						authType: 'MICROSOFT_OAUTH',
						hasStoredPassword: false,
						hasStoredAccountLoginPassword: true,
						capabilitySummary: buildCapabilitySummary({ usesOAuth: true, refreshToken: true }),
					}),
				],
				total: 1,
			}) as never,
		);

		render(
			<MemoryRouter
				future={{
					v7_relativeSplatPath: true,
					v7_startTransition: true,
				}}
			>
				<EmailsPage />
			</MemoryRouter>,
		);

		await screen.findByText('oauth@example.com');
		const passwordButton = screen.getByRole('button', { name: /登录密码/ });
		expect(passwordButton).toHaveClass('ant-btn-primary');
	});
});
