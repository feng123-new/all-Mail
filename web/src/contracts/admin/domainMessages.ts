import { domainApi, domainMailboxApi, domainMessageApi } from '../../api';

export const domainMessagesContract = {
  getDomains: domainApi.getList,
  getMailboxes: domainMailboxApi.getList,
  getList: domainMessageApi.getList,
  getById: domainMessageApi.getById,
  delete: domainMessageApi.delete,
  batchDelete: domainMessageApi.batchDelete,
};
