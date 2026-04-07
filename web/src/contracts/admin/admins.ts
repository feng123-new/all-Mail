import { adminApi } from '../../api';

export const adminsContract = {
  getList: adminApi.getList,
  getById: adminApi.getById,
  create: adminApi.create,
  update: adminApi.update,
  delete: adminApi.delete,
};
