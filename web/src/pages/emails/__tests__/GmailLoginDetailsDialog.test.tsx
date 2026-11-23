import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { requestPatch, requestPost } from '../../../api/core';
import { emailsContract } from '../../../contracts/admin/emails';
import { I18nProvider } from '../../../i18n';
import { useAuthStore } from '../../../stores/authStore';
import GmailWorkspace from '../GmailWorkspace';

vi.mock('../../../api/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../api/core')>(), requestPost: vi.fn(), requestPatch: vi.fn(),
}));
vi.mock('../../../contracts/admin/emails', () => ({
  emailsContract: { getList: vi.fn(), viewMails: vi.fn(), revealUnlock: vi.fn() },
}));

it('keeps saved Google login details separate from mail and discards unlocked data', async () => {
  const user = userEvent.setup();
  const clipboard = vi.spyOn(navigator.clipboard, 'writeText');
  const realNow = Date.now.bind(Date);
  const realMonotonic = performance.now.bind(performance);
  let elapsed = 0;
  const now = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + elapsed);
  const monotonic = vi.spyOn(performance, 'now').mockImplementation(() => realMonotonic() + elapsed);
  const serverClock = 3_600_000;
  const iso = (time: number) => new Date(time).toISOString();
  const ok = <T,>(data: T) => ({ code: 200, message: 'ok', data });
  const admin = { id: 42, username: 'synthetic-admin', role: 'ADMIN' as const };
  const a = { id: 7, email: 'readonly@example.test', provider: 'GMAIL', status: 'ACTIVE', capabilitySummary: { sendMail: false } };
  const b = { ...a, id: 8, email: 'disabled@example.test', status: 'DISABLED' };
  let password = 'synthetic-login-password';
  let notes = '初始笔记\n<em>plain text</em>';
  let storedKey = true;
  let reads = 0;
  let delayedCode = false;
  const path = '/admin/emails/8/login-details';
  vi.mocked(emailsContract.getList).mockImplementation(async (params) => ok({ list: params?.status === 'DISABLED' ? [b] : [a, b], total: params?.status === 'DISABLED' ? 1 : 2 }) as never);
  vi.mocked(emailsContract.viewMails).mockResolvedValue(ok({ messages: [] }));
  vi.mocked(emailsContract.revealUnlock).mockImplementation(async () => ok({ grantToken: 'synthetic-grant', expiresAt: iso(Date.now() + serverClock + 60_000) }));
  vi.mocked(requestPost).mockImplementation(async (_url, data) => {
    const codeOnly = (data as { codeOnly?: boolean }).codeOnly;
    const result = ok({
      ...(codeOnly ? { password: 'must-not-merge', notes: 'must-not-merge' } : { password: password || undefined, notes: notes || undefined }),
      code: storedKey ? (codeOnly ? '234567' : '123456') : null,
      codeExpiresAt: storedKey ? iso(Date.now() + serverClock + (reads++ === 0 ? 5_000 : 30_000)) : null,
      serverTime: iso(Date.now() + serverClock),
    });
    if (codeOnly && delayedCode) elapsed += 30_500;
    return result as never;
  });
  vi.mocked(requestPatch).mockImplementation(async (_url, data) => {
    const patch = data as { password?: string; notes?: string; totpSecret?: string };
    password = patch.password ?? password;
    notes = patch.notes ?? (patch.password === '' ? '另一处修改的备注' : notes);
    if (patch.totpSecret !== undefined) storedKey = Boolean(patch.totpSecret);
    return ok({ updated: true }) as never;
  });
  useAuthStore.getState().setAuth({ ...admin, twoFactorEnabled: false });
  const view = render(<I18nProvider initialLanguage="en-US" persist={false}><GmailWorkspace gmailConfigured={false} onConfigure={vi.fn()} /></I18nProvider>);

  try {
    const entry = await screen.findByRole('button', { name: 'Google login details' }, { timeout: 5000 });
    expect(screen.getByRole('button', { name: 'Compose' })).toBeDisabled();
    await user.click(entry);
    let dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Google login details')).toBeInTheDocument();
    expect(dialog.getByText(/enable all-Mail admin two-factor authentication/i)).toBeInTheDocument();
    expect(dialog.queryByLabelText('all-Mail admin code')).not.toBeInTheDocument();
    expect(emailsContract.revealUnlock).not.toHaveBeenCalled();

    act(() => useAuthStore.getState().setAuth({ ...admin, twoFactorEnabled: true }));
    await user.click(dialog.getByRole('combobox', { name: 'Saved Gmail account' }));
    await user.click(await screen.findByRole('option', { name: b.email }));
    fireEvent.change(dialog.getByLabelText('all-Mail admin code'), { target: { value: '654321' } });
    await user.click(dialog.getByRole('button', { name: 'Unlock' }));
    expect(await dialog.findByText('123456')).toBeInTheDocument();
    expect(dialog.getByText(/expires in [1-5] s/i)).toBeInTheDocument();
    expect(emailsContract.revealUnlock).toHaveBeenCalledWith({ otp: '654321' });
    expect(requestPost).toHaveBeenLastCalledWith(path, { grantToken: 'synthetic-grant', email: b.email }, { signal: expect.any(AbortSignal) });
    expect(dialog.queryByText(password)).not.toBeInTheDocument();
    expect(dialog.getByLabelText('Plaintext notes')).toHaveValue(notes);
    expect(dialog.queryByText('plain text', { selector: 'em' })).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Reveal password' }));
    expect(dialog.getByText(password)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Copy password' }));
    expect(clipboard).toHaveBeenCalledWith(password);
    await user.click(dialog.getByRole('button', { name: 'Hide password' }));
    expect(dialog.queryByText(password)).not.toBeInTheDocument();

    elapsed = 6_000;
    await waitFor(() => expect(dialog.queryByText('123456')).not.toBeInTheDocument());
    await user.click(dialog.getByRole('button', { name: 'Refresh Google code' }));
    expect(await dialog.findByText('234567')).toBeInTheDocument();
    expect(requestPost).toHaveBeenLastCalledWith(path, { grantToken: 'synthetic-grant', email: b.email, codeOnly: true }, { signal: expect.any(AbortSignal) });
    expect(dialog.getByLabelText('Plaintext notes')).toHaveValue(notes);
    await user.click(dialog.getByRole('button', { name: 'Reveal password' }));
    expect(dialog.getByText(password)).toBeInTheDocument();
    delayedCode = true;
    await user.click(dialog.getByRole('button', { name: 'Refresh Google code' }));
    expect(await dialog.findByText('Code expired')).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Copy code' })).not.toBeInTheDocument();
    delayedCode = false;

    const edited = '更新后的笔记\n<strong>still plain</strong>';
    fireEvent.change(dialog.getByLabelText('Plaintext notes'), { target: { value: edited } });
    fireEvent.change(dialog.getByLabelText('Google Authenticator setup key'), { target: { value: '123456' } });
    await user.click(dialog.getByRole('button', { name: 'Save changes' }));
    expect(dialog.getByText(/enter a Base32 Google Authenticator setup key/i)).toBeInTheDocument();
    expect(requestPatch).not.toHaveBeenCalled();
    fireEvent.change(dialog.getByLabelText('Google Authenticator setup key'), { target: { value: 'jbsw y3dp ehpk 3pxp' } });
    await user.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Clear password' })).toBeEnabled());
    expect(requestPatch).toHaveBeenLastCalledWith(path, { grantToken: 'synthetic-grant', email: b.email, notes: edited, totpSecret: 'JBSWY3DPEHPK3PXP' }, { signal: expect.any(AbortSignal) });
    expect(dialog.getByLabelText('Google Authenticator setup key')).toHaveValue('');
    expect(dialog.getByLabelText('Plaintext notes')).toHaveValue(edited);

    for (const [label, field] of [['Clear password', 'password'], ['Clear setup key', 'totpSecret'], ['Clear notes', 'notes']] as const) {
      await user.click(dialog.getByRole('button', { name: label }));
      await waitFor(() => expect(dialog.getByRole('button', { name: label })).toBeDisabled());
      expect(requestPatch).toHaveBeenLastCalledWith(path, { grantToken: 'synthetic-grant', email: b.email, [field]: '' }, { signal: expect.any(AbortSignal) });
      if (field === 'password') {
        expect(dialog.getByLabelText('Plaintext notes')).toHaveValue('另一处修改的备注');
        expect(dialog.getByRole('button', { name: 'Save changes' })).toBeDisabled();
      }
    }
    expect(requestPatch).toHaveBeenCalledTimes(4);
    expect(dialog.getByLabelText('Plaintext notes')).toHaveValue('');
    expect(dialog.queryByText('123456')).not.toBeInTheDocument();

    fireEvent.change(dialog.getByLabelText('New Google login password'), { target: { value: 'transient-password' } });
    elapsed = 61_000;
    expect(await dialog.findByText(/unlock expired/i)).toBeInTheDocument();
    expect(dialog.queryByLabelText('Plaintext notes')).not.toBeInTheDocument();
    expect(dialog.queryByDisplayValue('transient-password')).not.toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Close' }));
    await user.click(entry);
    dialog = within(screen.getByRole('dialog'));
    expect(dialog.queryByLabelText('Plaintext notes')).not.toBeInTheDocument();
    expect(emailsContract.revealUnlock).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    useAuthStore.getState().clearAuth();
    now.mockRestore();
    monotonic.mockRestore();
    clipboard.mockRestore();
  }
}, 30_000);
