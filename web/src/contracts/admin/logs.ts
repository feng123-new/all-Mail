import { logsApi } from '../../api';

export const logsContract = {
  getList: logsApi.getList,
  delete: logsApi.delete,
  batchDelete: logsApi.batchDelete,
};
