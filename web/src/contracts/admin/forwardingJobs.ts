import { domainApi, domainMailboxApi, forwardingJobsApi } from '../../api';

export const forwardingJobsContract = {
  getDomains: domainApi.getList,
  getMailboxes: domainMailboxApi.getList,
  getList: forwardingJobsApi.getList,
  getById: forwardingJobsApi.getById,
  requeue: forwardingJobsApi.requeue,
};
