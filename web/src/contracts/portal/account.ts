import { mailboxPortalApi } from '../../api';

export type {
  MailboxPortalTwoFactorResult,
  MailboxPortalTwoFactorSetup,
  MailboxPortalTwoFactorStatus,
} from '../../api/auth';

export const portalAccountContract = {
  login: mailboxPortalApi.login,
  logout: mailboxPortalApi.logout,
  getSession: mailboxPortalApi.getSession,
  getMailboxes: mailboxPortalApi.getMailboxes,
  getMessages: mailboxPortalApi.getMessages,
  getForwardingJobs: mailboxPortalApi.getForwardingJobs,
  changePassword: mailboxPortalApi.changePassword,
  getTwoFactorStatus: mailboxPortalApi.getTwoFactorStatus,
  setupTwoFactor: mailboxPortalApi.setupTwoFactor,
  enableTwoFactor: mailboxPortalApi.enableTwoFactor,
  disableTwoFactor: mailboxPortalApi.disableTwoFactor,
  updateForwarding: mailboxPortalApi.updateForwarding,
};
