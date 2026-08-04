import type { EmailStats, Stats } from './shared';

export const EMPTY_EMAIL_STATS: EmailStats = Object.freeze({
  total: 0,
  active: 0,
  error: 0,
  providers: {},
});

export const EMPTY_DASHBOARD_STATS: Stats = Object.freeze({
  apiKeys: { total: 0, active: 0, totalUsage: 0, todayActive: 0 },
  domainMail: {
    domains: 0,
    activeDomains: 0,
    mailboxes: 0,
    activeMailboxes: 0,
    inboundMessages: 0,
    outboundMessages: 0,
  },
});

export const resolveEmailStats = (value: EmailStats | null): EmailStats =>
  value || EMPTY_EMAIL_STATS;

export const resolveDashboardStats = (value: Stats | null): Stats =>
  value || EMPTY_DASHBOARD_STATS;
