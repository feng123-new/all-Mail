import { defineMessage } from '../../i18n/messages';

export const gmailWorkspaceI18n = {
  title: defineMessage('emails.gmailWorkspace.title', 'Gmail 工作区', 'Gmail workspace'),
  loginDetails: defineMessage('gmailDetails.title', 'Google 登录资料', 'Google login details'),
  accountsFailed: defineMessage('emails.gmailWorkspace.accountsFailed', '无法加载 Gmail 账号。请刷新后重试。', 'Could not load Gmail accounts. Refresh to try again.'),
  accountsMailFailed: defineMessage('emails.gmailWorkspace.accountsMailFailed', '无法加载 Gmail 邮件。', 'Could not load Gmail mail.'),
} as const;
