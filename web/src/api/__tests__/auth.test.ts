import { beforeEach, describe, expect, it, vi } from 'vitest';

const coreMocks = vi.hoisted(() => ({
  requestGet: vi.fn(),
  requestPost: vi.fn(),
  requestPut: vi.fn(),
}));

vi.mock('../core', () => ({
  MAILBOX_PORTAL_PREFIX: '/mail/api',
  requestGet: coreMocks.requestGet,
  requestPost: coreMocks.requestPost,
  requestPut: coreMocks.requestPut,
}));

import { mailboxPortalApi } from '../auth';

describe('mailboxPortalApi two-factor authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends an OTP with a mailbox portal login challenge retry', () => {
    mailboxPortalApi.login('portal-user', 'correct-horse', '123456');

    expect(coreMocks.requestPost).toHaveBeenCalledWith('/mail/api/login', {
      username: 'portal-user',
      password: 'correct-horse',
      otp: '123456',
    });
  });

  it('uses the shared portal 2FA endpoints and payloads', () => {
    mailboxPortalApi.getTwoFactorStatus();
    mailboxPortalApi.setupTwoFactor();
    mailboxPortalApi.enableTwoFactor('123456');
    mailboxPortalApi.disableTwoFactor('correct-horse', '654321');

    expect(coreMocks.requestGet).toHaveBeenCalledWith('/mail/api/2fa/status');
    expect(coreMocks.requestPost).toHaveBeenNthCalledWith(1, '/mail/api/2fa/setup');
    expect(coreMocks.requestPost).toHaveBeenNthCalledWith(2, '/mail/api/2fa/enable', { otp: '123456' });
    expect(coreMocks.requestPost).toHaveBeenNthCalledWith(3, '/mail/api/2fa/disable', {
      password: 'correct-horse',
      otp: '654321',
    });
  });
});
