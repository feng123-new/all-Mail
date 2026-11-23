import { useEffect, useMemo, useState } from 'react';
import { requestTemporaryGmail, type GmailAppPassword } from '../../api/gmailTemporary';
import type { EmailAuthType, EmailProvider, ProviderProfileCapabilities } from '../../constants/providers';
import { emailsContract } from '../../contracts/admin/emails';
import { requestData } from '../../utils/request';
import { gmailWorkspaceI18n } from './gmailWorkspaceMessages';

export type GmailFolder = 'INBOX' | 'SENT';

export interface GmailAccount {
  id: number | string;
  email: string;
  provider: EmailProvider;
  authType: EmailAuthType;
  status: 'ACTIVE' | 'ERROR' | 'DISABLED';
  capabilitySummary?: Pick<ProviderProfileCapabilities, 'readInbox' | 'readSent' | 'sendMail'>;
}

export interface GmailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  text?: string;
  html?: string;
}

export interface GmailMessageRow {
  message: GmailMessage;
  account: GmailAccount;
  folder: GmailFolder;
  timestamp: number;
  uidValidity?: number;
}

const PAGE_SIZE = 100;
const CONCURRENT_ACCOUNTS = 3;
export const GMAIL_RECENT_MESSAGE_LIMIT = 25;

export function useGmailWorkspaceMail(
  folder: GmailFolder,
  view: number,
  revision: string,
  temporary: ReadonlyMap<string, GmailAppPassword>,
) {
  const [accountResult, setAccountResult] = useState<{ revision: string; accounts: GmailAccount[] | null }>();
  const [folderResult, setFolderResult] = useState<{
    key: string;
    rows: GmailMessageRow[];
    failures: GmailAccount[];
    loading: boolean;
  }>();
  const saved = accountResult?.revision === revision ? accountResult.accounts : undefined;
  const accounts = useMemo(() => {
    if (saved === undefined) return undefined;
    return [
      ...(saved?.filter((account) => account.status !== 'DISABLED') ?? []),
      ...Array.from(temporary, ([id, credential]): GmailAccount => ({
        id, email: credential.email, provider: 'GMAIL', authType: 'APP_PASSWORD', status: 'ACTIVE',
        capabilitySummary: { readInbox: true, readSent: true, sendMail: true },
      })),
    ];
  }, [saved, temporary]);
  const folderKey = `${revision}:${folder}:${view}`;

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const loadAccounts = async () => {
      const accountsById = new Map<number, GmailAccount>();
      for (let page = 1; !signal.aborted; page += 1) {
        const result = await requestData<{ list: GmailAccount[]; total: number }>(
          () => emailsContract.getList<GmailAccount>({ page, pageSize: PAGE_SIZE, provider: 'GMAIL' }, signal),
          gmailWorkspaceI18n.accountsFailed,
          { silent: true },
        );
        if (signal.aborted) return;
        if (!result) {
          setAccountResult({ revision, accounts: null });
          return;
        }
        for (const account of result.list) {
          if (typeof account.id === 'number' && account.provider === 'GMAIL') {
            accountsById.set(account.id, account);
          }
        }
        if (page * PAGE_SIZE >= result.total || result.list.length === 0) {
          setAccountResult({ revision, accounts: [...accountsById.values()] });
          return;
        }
      }
    };
    void loadAccounts();
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!accounts?.length) return;
    const controller = new AbortController();
    const { signal } = controller;
    const readable = accounts.filter((account) =>
      account.capabilitySummary?.[folder === 'INBOX' ? 'readInbox' : 'readSent'] !== false,
    );
    const rows: GmailMessageRow[] = [];
    const failures: GmailAccount[] = [];
    let next = 0;
    let remaining = readable.length;
    const publish = () => setFolderResult({
      key: folderKey,
      rows: [...rows].sort((a, b) => b.timestamp - a.timestamp || a.account.email.localeCompare(b.account.email) || a.message.id.localeCompare(b.message.id)),
      failures: [...failures],
      loading: remaining > 0,
    });

    const worker = async () => {
      while (!signal.aborted && next < readable.length) {
        const account = readable[next++];
        const id = account.id;
        const credential = typeof id === 'string' ? temporary.get(id) : undefined;
        const result = await requestData<{ messages: GmailMessage[]; mailboxCheckpoint?: { uidValidity?: number } }>(
          () => typeof id === 'number'
            ? emailsContract.viewMails<GmailMessage>(id, folder, false, { signal, limit: GMAIL_RECENT_MESSAGE_LIMIT })
            : credential ? requestTemporaryGmail(credential, { operation: 'list', mailbox: folder }, signal) : Promise.resolve(null),
          gmailWorkspaceI18n.accountsMailFailed,
          { silent: true },
        );
        if (signal.aborted) return;
        if (result) {
          for (const message of result.messages) {
            const timestamp = Date.parse(message.date);
            rows.push({
              message, account, folder, timestamp: Number.isFinite(timestamp) ? timestamp : -Infinity,
              uidValidity: result.mailboxCheckpoint?.uidValidity,
            });
          }
        } else {
          failures.push(account);
        }
        remaining -= 1;
        publish();
      }
    };

    if (!remaining) void Promise.resolve().then(() => { if (!signal.aborted) publish(); });
    for (let i = 0; i < Math.min(CONCURRENT_ACCOUNTS, readable.length); i += 1) void worker();
    return () => controller.abort();
  }, [accounts, folder, folderKey, temporary]);

  return { accounts, savedAccounts: saved, accountLoadFailed: saved === null, folderResult: folderResult?.key === folderKey ? folderResult : undefined };
}
