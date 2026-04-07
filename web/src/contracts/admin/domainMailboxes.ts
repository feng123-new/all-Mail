import { apiKeyApi, domainApi, domainMailboxApi, mailboxUserApi } from '../../api';

export const domainMailboxesContract = {
  getDomains: domainApi.getList,
  getMailboxes: domainMailboxApi.getList,
  createMailbox: domainMailboxApi.create,
  updateMailbox: domainMailboxApi.update,
  batchCreateMailboxes: domainMailboxApi.batchCreate,
  batchDeleteMailboxes: domainMailboxApi.batchDelete,
  deleteMailbox: domainMailboxApi.delete,
  getUsers: mailboxUserApi.getList,
  addMailboxesToUser: mailboxUserApi.addMailboxes,
  getApiKeys: apiKeyApi.getList,
};
