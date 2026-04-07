import { domainApi } from '../../api';

export const domainsContract = {
  getList: domainApi.getList,
  getById: domainApi.getById,
  create: domainApi.create,
  update: domainApi.update,
  verify: domainApi.verify,
  saveCatchAll: domainApi.saveCatchAll,
  saveSendingConfig: domainApi.saveSendingConfig,
  getAliases: domainApi.getAliases,
  createAlias: domainApi.createAlias,
  updateAlias: domainApi.updateAlias,
  delete: domainApi.delete,
  deleteAlias: domainApi.deleteAlias,
};
