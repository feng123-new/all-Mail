import { LONG_RUNNING_CHECK_TIMEOUT_MS, requestPost } from './core';

export interface GmailAppPassword {
  email: string;
  password: string;
}

type GmailFolder = 'INBOX' | 'SENT';

type TemporaryOperation =
  | { operation: 'list'; mailbox: GmailFolder }
  | { operation: 'detail'; mailbox: GmailFolder; messageId: string; uidValidity: number }
  | { operation: 'send'; message: { to: string[]; subject: string; text: string } };

export function requestTemporaryGmail<T>(
  credentials: GmailAppPassword,
  operation: TemporaryOperation,
  signal?: AbortSignal,
) {
  return requestPost<T, GmailAppPassword & TemporaryOperation>(
    '/admin/emails/gmail/temporary',
    { ...credentials, ...operation },
    { timeout: LONG_RUNNING_CHECK_TIMEOUT_MS, signal },
  );
}
