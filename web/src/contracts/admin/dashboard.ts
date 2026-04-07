import { dashboardApi, emailApi } from '../../api';

export const dashboardContract = {
  getStats: dashboardApi.getStats,
  getApiTrend: dashboardApi.getApiTrend,
  getLogs: dashboardApi.getLogs,
  getEmailStats: emailApi.getStats,
  getErrorEmails: emailApi.getList,
};
