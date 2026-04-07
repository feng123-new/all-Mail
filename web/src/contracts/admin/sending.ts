import { domainApi, domainMailboxApi, sendingApi } from '../../api';

export const sendingContract = {
  getConfigs: sendingApi.getConfigs,
  getMessages: sendingApi.getMessages,
  deleteConfig: sendingApi.deleteConfig,
  deleteMessage: sendingApi.deleteMessage,
  batchDeleteMessages: sendingApi.batchDeleteMessages,
  send: sendingApi.send,
  getDomains: domainApi.getList,
  getMailboxes: domainMailboxApi.getList,
};
