import { mailboxPortalApi } from '../../api';

export const portalAccountContract = {
  login: mailboxPortalApi.login,
  logout: mailboxPortalApi.logout,
  getSession: mailboxPortalApi.getSession,
  getMailboxes: mailboxPortalApi.getMailboxes,
  getMessages: mailboxPortalApi.getMessages,
  getForwardingJobs: mailboxPortalApi.getForwardingJobs,
  changePassword: mailboxPortalApi.changePassword,
  updateForwarding: mailboxPortalApi.updateForwarding,
};
