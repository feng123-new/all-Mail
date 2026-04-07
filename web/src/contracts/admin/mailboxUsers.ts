import { domainMailboxApi, mailboxUserApi } from '../../api';

export const mailboxUsersContract = {
  getUsers: mailboxUserApi.getList,
  getById: mailboxUserApi.getById,
  create: mailboxUserApi.create,
  update: mailboxUserApi.update,
  addMailboxes: mailboxUserApi.addMailboxes,
  delete: mailboxUserApi.delete,
  getMailboxes: domainMailboxApi.getList,
};
