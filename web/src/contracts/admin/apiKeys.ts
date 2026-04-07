import { apiKeyApi, domainApi, emailApi, groupApi } from '../../api';

export const apiKeysContract = {
  getList: apiKeyApi.getList,
  getById: apiKeyApi.getById,
  create: apiKeyApi.create,
  update: apiKeyApi.update,
  delete: apiKeyApi.delete,
  getAllocationStats: apiKeyApi.getAllocationStats,
  resetAllocation: apiKeyApi.resetAllocation,
  getAssignedMailboxes: apiKeyApi.getAssignedMailboxes,
  updateAssignedMailboxes: apiKeyApi.updateAssignedMailboxes,
  getDomains: domainApi.getList,
  getGroups: groupApi.getList,
  getEmails: emailApi.getList,
};
