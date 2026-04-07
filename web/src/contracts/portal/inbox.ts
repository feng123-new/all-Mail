import { mailboxPortalApi } from '../../api';

export const portalInboxContract = {
  getMailboxes: mailboxPortalApi.getMailboxes,
  getMessages: mailboxPortalApi.getMessages,
  getMessage: mailboxPortalApi.getMessage,
  getSentMessages: mailboxPortalApi.getSentMessages,
  getSentMessage: mailboxPortalApi.getSentMessage,
  sendMessage: mailboxPortalApi.sendMessage,
};
