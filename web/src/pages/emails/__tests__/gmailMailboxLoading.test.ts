import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { emailsContract } from '../../../contracts/admin/emails';
import { type GmailFolder, useGmailWorkspaceMail } from '../useGmailWorkspaceMail';

vi.mock('../../../contracts/admin/emails', () => ({
  emailsContract: { getList: vi.fn(), viewMails: vi.fn() },
}));

it('bounds Gmail listing and merges the current folder by date after an account fails', async () => {
  const list = [1, 2, 3, 4, 5].map((id) => ({
    id, email: `mailbox-${id}@example.test`, provider: 'GMAIL', status: 'ACTIVE',
    capabilitySummary: { readInbox: true, readSent: true, sendMail: id === 2 },
  }));
  vi.mocked(emailsContract.getList).mockResolvedValue({ code: 200, data: { list, total: list.length } } as never);
  const dates = ['2030-01-01T09:00:00-05:00', '2030-01-01T13:30:00Z', '', '2030-01-01T12:00:00Z', '2030-01-01T11:00:00Z'];
  let resolveInbox!: (value: unknown) => void;
  const inbox = new Promise((resolve) => { resolveInbox = resolve; });
  vi.mocked(emailsContract.viewMails).mockImplementation(async (id, folder) => {
    if (folder === 'INBOX') return await inbox as never;
    if (id === 3) throw new Error('Synthetic provider failure');
    return { code: 200, data: { messages: [{ id: 'same-provider-id', subject: `Message ${id}`, date: dates[id - 1] }] } } as never;
  });

  const temporary = new Map<never, never>();
  const { result, rerender } = renderHook(({ folder }: { folder: GmailFolder }) => (
    useGmailWorkspaceMail(folder, folder === 'INBOX' ? 0 : 1, '0', temporary)
  ), { initialProps: { folder: 'INBOX' } });
  await waitFor(() => expect(emailsContract.viewMails).toHaveBeenCalledTimes(3));
  const [,, markAsSeen, options] = vi.mocked(emailsContract.viewMails).mock.calls[0];
  expect(markAsSeen).toBe(false);
  expect(options?.limit).toBe(25);

  rerender({ folder: 'SENT' });
  await waitFor(() => expect(result.current.folderResult?.loading).toBe(false));
  expect(options?.signal.aborted).toBe(true);
  expect(result.current.folderResult?.rows.map((row) => [row.account.id, row.folder, row.message.id])).toEqual(
    [1, 2, 4, 5].map((id) => [id, 'SENT', 'same-provider-id']),
  );
  expect(result.current.folderResult?.failures.map((account) => account.id)).toEqual([3]);

  await act(async () => resolveInbox({ code: 200, data: { messages: [{ id: 'late-inbox-result', date: dates[0] }] } }));
  expect(result.current.folderResult?.rows.every((row) => row.folder === 'SENT')).toBe(true);
  expect(emailsContract.viewMails).toHaveBeenCalledTimes(8);
});
