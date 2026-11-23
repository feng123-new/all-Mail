import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emailsContract } from '../../../contracts/admin/emails';
import { I18nProvider } from '../../../i18n';
import GmailWorkspace from '../GmailWorkspace';

vi.mock('../../../contracts/admin/emails', () => ({
  emailsContract: {
    getList: vi.fn(),
    viewMails: vi.fn(),
    viewMailDetail: vi.fn(),
    sendMail: vi.fn(),
    startAuthorization: vi.fn(),
  },
}));

const ok = <T,>(data: T) => ({ code: 200, data });
const mailbox = (id: number, sendMail: boolean) => ({
  id,
  email: `mailbox-${id}@example.test`,
  provider: 'GMAIL',
  authType: 'GOOGLE_OAUTH',
  status: 'ACTIVE',
  capabilitySummary: { readInbox: true, readSent: true, sendMail },
});
const summary = (subject: string, date: string) => ({
  id: 'same-provider-id', from: 'sender@example.test', to: 'recipient@example.test', subject, date,
});
function openWorkspace(gmailConfigured = true) {
  const user = userEvent.setup();
  const onConfigure = vi.fn();
  render(
    <I18nProvider initialLanguage="en-US" persist={false}>
      <GmailWorkspace gmailConfigured={gmailConfigured} onConfigure={onConfigure} />
    </I18nProvider>,
  );
  return { user, workspace: screen, onConfigure };
}

const renderWait = { timeout: 5000 };

describe('Gmail workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(emailsContract.getList).mockImplementation(async (params) => ok({
      list: params?.page === 1
        ? [mailbox(1, false), mailbox(2, true), { ...mailbox(4, true), status: 'DISABLED' }]
        : [mailbox(3, true)],
      total: 101,
    }) as never);
    vi.mocked(emailsContract.viewMails).mockImplementation(async (id, folder) => {
      if (id === 3) throw new Error('Synthetic mailbox failure');
      const date = id === 1 ? '2030-01-01T09:00:00-05:00' : '2030-01-01T13:30:00Z';
      return ok({ messages: [summary(`${folder} ${id}`, date)] }) as never;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('merges by normalized date and keeps account, folder, and sender identity separate', async () => {
    const { user, workspace } = openWorkspace();
    const first = await workspace.findByRole('button', { name: 'INBOX 1' }, renderWait);
    const second = await workspace.findByRole('button', { name: 'INBOX 2' }, renderWait);
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await workspace.findByText(/could not load mail.*mailbox-3@example.test/i, {}, renderWait)).toBeInTheDocument();
    expect(workspace.getByText('mailbox-1@example.test')).toBeInTheDocument();
    expect(emailsContract.getList).toHaveBeenNthCalledWith(1, { provider: 'GMAIL', page: 1, pageSize: 100 }, expect.any(AbortSignal));
    expect(emailsContract.getList).toHaveBeenNthCalledWith(2, { provider: 'GMAIL', page: 2, pageSize: 100 }, expect.any(AbortSignal));
    expect(vi.mocked(emailsContract.viewMails).mock.calls.some(([id]) => id === 4)).toBe(false);

    await user.click(workspace.getByRole('tab', { name: 'Sent' }));
    await workspace.findByRole('button', { name: 'SENT 1' }, renderWait);

    const html = '<img alt="tracker" src="https://example.test/track"><script>unsafe</script>';
    vi.mocked(emailsContract.viewMailDetail).mockResolvedValue(ok({ ...summary('SENT 2', ''), text: 'Exact plain text', html }) as never);
    await user.click(workspace.getByRole('button', { name: 'SENT 2' }));
    const detail = within(await screen.findByRole('dialog', {}, renderWait));
    expect(detail.getByText('SENT 2')).toBeInTheDocument();
    expect(await detail.findByText('Exact plain text')).toBeInTheDocument();
    expect(detail.queryByAltText('tracker')).not.toBeInTheDocument();
    expect(emailsContract.viewMailDetail).toHaveBeenCalledWith(2, 'SENT', 'same-provider-id', expect.any(AbortSignal));
    await user.click(detail.getByRole('button', { name: 'Close' }));

    vi.mocked(emailsContract.sendMail).mockResolvedValue(ok({}) as never);
    await user.click(workspace.getByRole('button', { name: 'Compose' }));
    const compose = within(await screen.findByRole('dialog', {}, renderWait));
    expect(compose.getByText('Compose')).toBeInTheDocument();
    expect(compose.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.click(compose.getByRole('combobox', { name: 'From' }));
    expect(screen.queryByText('mailbox-1@example.test', { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument();
    expect(screen.queryByText('mailbox-4@example.test', { selector: '.ant-select-item-option-content' })).not.toBeInTheDocument();
    await user.click(await screen.findByText('mailbox-2@example.test', { selector: '.ant-select-item-option-content' }));
    await user.type(compose.getByRole('textbox', { name: 'To' }), 'recipient@example.test');
    await user.type(compose.getByRole('textbox', { name: 'Subject' }), 'Synthetic subject');
    await user.type(compose.getByRole('textbox', { name: 'Message' }), 'Synthetic body');
    await user.click(compose.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(emailsContract.sendMail).toHaveBeenCalledWith(2, {
      to: ['recipient@example.test'], subject: 'Synthetic subject', text: 'Synthetic body',
    }));
  }, 30000);

  it('assigns a verified Google URL in the same tab and rejects lookalike hosts', async () => {
    const popup = vi.spyOn(window, 'open').mockImplementation(() => null);
    const assign = vi.fn();
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic';
    vi.mocked(emailsContract.startAuthorization).mockImplementation(async () => {
      vi.stubGlobal('window', Object.create(window, { location: { value: { assign } } }));
      return ok({ authUrl }) as never;
    }).mockResolvedValueOnce(ok({ authUrl: 'https://accounts.google.com.example.test/' }) as never);

    const { user, workspace } = openWorkspace();
    const connect = workspace.getByRole('button', { name: 'Connect with Google' });
    await user.click(connect);
    expect(await workspace.findByText('Google returned an invalid authorization URL.')).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    try {
      await user.click(connect);
      await waitFor(() => expect(assign).toHaveBeenCalledWith(authUrl));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(emailsContract.startAuthorization).toHaveBeenCalledTimes(2);
    expect(emailsContract.startAuthorization).toHaveBeenLastCalledWith('GMAIL', {});
    expect(popup).not.toHaveBeenCalled();
  });

  it('uses existing configuration when Google is unconfigured and defaults the only viable sender', async () => {
    vi.mocked(emailsContract.getList).mockResolvedValue(ok({ list: [mailbox(1, false), mailbox(2, true)], total: 2 }) as never);
    const { user, workspace, onConfigure } = openWorkspace(false);
    await user.click(workspace.getByRole('button', { name: 'Configure Google OAuth' }));
    expect(onConfigure).toHaveBeenCalledOnce();
    expect(emailsContract.startAuthorization).not.toHaveBeenCalled();
    const composeButton = workspace.getByRole('button', { name: 'Compose' });
    await waitFor(() => expect(composeButton).toBeEnabled(), renderWait);
    await user.click(composeButton);
    const compose = within(await screen.findByRole('dialog', {}, renderWait));
    expect(compose.getByText('Compose')).toBeInTheDocument();
    expect(compose.getByText('mailbox-2@example.test')).toBeInTheDocument();
  }, 15000);

  it('does not put a late Inbox result back into the Sent folder', async () => {
    let resolveInbox!: (value: unknown) => void;
    const slowInbox = new Promise((resolve) => { resolveInbox = resolve; });
    vi.mocked(emailsContract.viewMails).mockImplementation(async (_, folder) => (
      folder === 'INBOX' ? slowInbox : ok({ messages: [summary('Current sent result', '2030-01-01T13:30:00Z')] })
    ) as never);
    const { user, workspace } = openWorkspace();
    await waitFor(() => expect(emailsContract.viewMails).toHaveBeenCalled());
    await user.click(workspace.getByRole('tab', { name: 'Sent' }));
    await waitFor(() => expect(workspace.getAllByRole('button', { name: 'Current sent result' })).toHaveLength(3));
    await act(async () => resolveInbox(ok({ messages: [summary('Late inbox result', '')] })));
    expect(workspace.queryByRole('button', { name: 'Late inbox result' })).not.toBeInTheDocument();
  }, 20000);
});
